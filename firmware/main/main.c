/* main.c -- GaitSense ESP32 node.
 *
 * Pipeline, once per 5 s hop:
 *
 *   MPU6050 @100 Hz -> ring buffer -> 10 s window (50% overlap)
 *     -> gait_extract()  (the 10 deployed features, see gait_features.c)
 *     -> walking gate    (see should_score() -- this is not optional)
 *     -> score()         (models/model.c, compiled straight from the repo)
 *     -> POST /api/ingest
 *
 * What the score means: P(faller) is the exported model's estimate that this
 * person self-reported >= 2 falls in the year BEFORE the recording. It is a
 * retrospective classifier of fall history with a leave-one-subject-out AUC of
 * 0.592 -- barely above chance. Nothing here predicts a future fall. See the
 * repo README for why, and web/server/risk.py for how the website is required
 * to present it.
 */

#include <math.h>
#include <string.h>
#include <sys/time.h>

#include "esp_log.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "sdkconfig.h"

#include "gait_features.h"
#include "model.h"
#include "mpu6050.h"
#include "net.h"

static const char *TAG = "gaitsense";

#define SAMPLE_PERIOD_US (1000000 / (int)GAIT_FS)   /* 10 ms -> 100 Hz */
#define UPLOAD_QUEUE_LEN 64                          /* ~5 min of buffering */

/* ---------------------------------------------------------------------------
 * Walking gate
 *
 * The model was trained exclusively on supervised lab walks, so feeding it a
 * window of someone sitting still is out-of-distribution and the output is
 * meaningless. This is not theoretical: the repo's conformance fixture has a
 * standing_still case whose sensor noise yields 22 "steps" and a confident
 * P(faller) = 0.89. Step count alone cannot filter that out, because the peak
 * detector's prominence threshold is relative to the signal's own standard
 * deviation and therefore scales down with the noise floor.
 *
 * So the gate keys on absolute movement energy as well as cadence.
 * ------------------------------------------------------------------------- */

/* Magnitude std over a 10 s window, in g. Quiet standing sits around
 * 0.003-0.01 g; ordinary walking is well above 0.1 g. */
#define WALK_MIN_MAGNITUDE_STD 0.06

/* 8 steps per 10 s = 48 steps/min, below any plausible sustained walk. */
#define WALK_MIN_STEPS 8

/* Cadence sanity band, steps/min. */
#define WALK_MIN_CADENCE 40.0
#define WALK_MAX_CADENCE 200.0

static bool is_walking(const gait_window_result_t *r)
{
    if (!(r->magnitude_std >= WALK_MIN_MAGNITUDE_STD)) return false;
    if (r->n_steps_window < WALK_MIN_STEPS) return false;
    if (!isfinite(r->cadence_spm)) return false;
    if (r->cadence_spm < WALK_MIN_CADENCE || r->cadence_spm > WALK_MAX_CADENCE) return false;
    return true;
}

/* A window is scoreable only when it is walking AND every feature is finite.
 *
 * The finiteness half is a hard correctness requirement, not caution. m2cgen
 * emits plain `if (input[i] < threshold)` comparisons and does not reproduce
 * XGBoost's learned default direction for missing values. A NaN comparison is
 * always false, so a NaN feature silently takes the right-hand branch of every
 * split it touches, regardless of which way the model was trained to send it.
 * The Python model handles this correctly via missing=np.nan; model.c cannot.
 * Rather than emit a number that quietly disagrees with the trained model, we
 * decline to score. */
static bool should_score(const gait_window_result_t *r)
{
    return is_walking(r) && r->features_valid;
}

/* ---------------------------------------------------------------------------
 * Sample ring buffer -- written only by imu_task, so it needs no lock.
 * ------------------------------------------------------------------------- */

static float s_rb_v[GAIT_WINDOW_SAMPLES];
static float s_rb_ml[GAIT_WINDOW_SAMPLES];
static float s_rb_ap[GAIT_WINDOW_SAMPLES];
static uint32_t s_rb_head;     /* next write slot */
static uint32_t s_rb_total;    /* samples ever written */

/* Window handed to analysis_task. imu_task fills it, analysis_task drains it;
 * s_window_ready is the handoff flag. */
static float s_win_v[GAIT_WINDOW_SAMPLES];
static float s_win_ml[GAIT_WINDOW_SAMPLES];
static float s_win_ap[GAIT_WINDOW_SAMPLES];
static volatile bool s_window_ready;
static SemaphoreHandle_t s_window_sem;

static QueueHandle_t s_upload_q;
static uint32_t s_steps_total;
static bool s_first_window = true;

/* ---------------------------------------------------------------------------
 * Axis mapping
 *
 * The training data comes from a sensor at L5 with named anatomical axes
 * (vertical / mediolateral / anterior-posterior); an MPU6050 only knows X, Y
 * and Z. Which raw axis is which depends entirely on how the board is mounted,
 * so the mapping is configuration, and log_orientation_hint() below checks it
 * against gravity at boot instead of letting a silent mis-mount produce
 * confident nonsense.
 * ------------------------------------------------------------------------- */

static float pick_axis(int sel, float x, float y, float z)
{
    switch (sel) {
        case 0: return  x;
        case 1: return -x;
        case 2: return  y;
        case 3: return -y;
        case 4: return  z;
        case 5: return -z;
        default: return 0.0f;
    }
}

static const char *axis_name(int sel)
{
    static const char *names[] = {"+X", "-X", "+Y", "-Y", "+Z", "-Z"};
    return (sel >= 0 && sel < 6) ? names[sel] : "??";
}

static void log_orientation_hint(void)
{
    /* Average a second of samples while the device is (presumably) at rest.
     * Whichever axis holds gravity should read about +1 g on the vertical
     * channel -- the saved training vector has vertical_mean = 0.929. */
    double sx = 0, sy = 0, sz = 0;
    const int n = 100;
    for (int i = 0; i < n; i++) {
        float x, y, z;
        if (mpu6050_read_accel_g(&x, &y, &z) == ESP_OK) { sx += x; sy += y; sz += z; }
        vTaskDelay(pdMS_TO_TICKS(10));
    }
    const float mx = (float)(sx / n), my = (float)(sy / n), mz = (float)(sz / n);

    const float v  = pick_axis(CONFIG_GAITSENSE_AXIS_V,  mx, my, mz);
    const float ml = pick_axis(CONFIG_GAITSENSE_AXIS_ML, mx, my, mz);
    const float ap = pick_axis(CONFIG_GAITSENSE_AXIS_AP, mx, my, mz);

    ESP_LOGI(TAG, "at-rest means: X=%+.3f Y=%+.3f Z=%+.3f g", mx, my, mz);
    ESP_LOGI(TAG, "mapped: vertical=%s (%+.3f) ml=%s (%+.3f) ap=%s (%+.3f) g",
             axis_name(CONFIG_GAITSENSE_AXIS_V), v,
             axis_name(CONFIG_GAITSENSE_AXIS_ML), ml,
             axis_name(CONFIG_GAITSENSE_AXIS_AP), ap);

    if (v < 0.7f || v > 1.3f) {
        ESP_LOGW(TAG, "vertical channel reads %+.3f g at rest, expected ~+1.0 g.", v);
        ESP_LOGW(TAG, "The axis mapping is probably wrong -- fix "
                      "GAITSENSE_AXIS_V/ML/AP in menuconfig. Features computed "
                      "on a mis-mapped sensor are out of distribution and the "
                      "score will be meaningless.");
    }
}

/* ---------------------------------------------------------------------------
 * Tasks
 * ------------------------------------------------------------------------- */

static SemaphoreHandle_t s_tick_sem;

/* Driven by esp_timer rather than vTaskDelay so the sample interval does not
 * drift with I2C latency: step timing is a model input, and a sample clock
 * that wanders would bias step_time_mean directly. */
static void IRAM_ATTR on_sample_tick(void *arg)
{
    BaseType_t woken = pdFALSE;
    xSemaphoreGiveFromISR(s_tick_sem, &woken);
    if (woken) portYIELD_FROM_ISR();
}

static void imu_task(void *arg)
{
    uint32_t last_window_at = 0;

    for (;;) {
        if (xSemaphoreTake(s_tick_sem, pdMS_TO_TICKS(1000)) != pdTRUE) {
            ESP_LOGW(TAG, "sample tick stalled");
            continue;
        }

        float x, y, z;
        if (mpu6050_read_accel_g(&x, &y, &z) != ESP_OK) continue;

        s_rb_v[s_rb_head]  = pick_axis(CONFIG_GAITSENSE_AXIS_V,  x, y, z);
        s_rb_ml[s_rb_head] = pick_axis(CONFIG_GAITSENSE_AXIS_ML, x, y, z);
        s_rb_ap[s_rb_head] = pick_axis(CONFIG_GAITSENSE_AXIS_AP, x, y, z);
        s_rb_head = (s_rb_head + 1) % GAIT_WINDOW_SAMPLES;
        s_rb_total++;

        const bool buffer_full = s_rb_total >= GAIT_WINDOW_SAMPLES;
        const bool hop_elapsed = (s_rb_total - last_window_at) >= GAIT_HOP_SAMPLES;
        if (!buffer_full || !hop_elapsed) continue;

        if (s_window_ready) {
            /* Analysis is still chewing on the previous window. Dropping this
             * one keeps sampling honest rather than stalling the sample clock. */
            ESP_LOGW(TAG, "analysis overrun, dropped a window");
            last_window_at = s_rb_total;
            continue;
        }

        /* Copy oldest-first. The buffer is full, so the oldest sample sits at
         * the write head. Done here, in the only task that touches the ring
         * buffer, so no lock is needed. */
        const uint32_t start = s_rb_head;
        for (uint32_t i = 0; i < GAIT_WINDOW_SAMPLES; i++) {
            const uint32_t j = (start + i) % GAIT_WINDOW_SAMPLES;
            s_win_v[i]  = s_rb_v[j];
            s_win_ml[i] = s_rb_ml[j];
            s_win_ap[i] = s_rb_ap[j];
        }
        last_window_at = s_rb_total;
        s_window_ready = true;
        xSemaphoreGive(s_window_sem);
    }
}

static void analysis_task(void *arg)
{
    gait_window_result_t r;

    for (;;) {
        if (xSemaphoreTake(s_window_sem, portMAX_DELAY) != pdTRUE) continue;

        const int64_t t0 = esp_timer_get_time();
        gait_extract(s_win_v, s_win_ml, s_win_ap, &r);
        const int64_t elapsed_us = esp_timer_get_time() - t0;

        const bool walking = is_walking(&r);
        const bool scored = should_score(&r);

        /* Only count steps while actually walking, for the same reason the
         * gate exists: a still sensor's noise floor produces phantom steps. */
        if (walking) {
            s_steps_total += s_first_window ? r.n_steps_window : r.n_steps_fresh;
            s_first_window = false;
        }

        gait_reading_t reading = {
            .steps_total = s_steps_total,
            .steps_window = r.n_steps_window,
            .walking = walking,
            .scored = scored,
            .prob_faller = NAN,
            .cadence_spm = r.cadence_spm,
            .stride_time_mean = r.stride_time_mean,
            .magnitude_std = r.magnitude_std,
            .rssi = 0,
        };
        memcpy(reading.features, r.features, sizeof(reading.features));

        if (scored) {
            double out[2];
            score(r.features, out);   /* models/model.c */
            reading.prob_faller = out[1];
        }

        struct timeval tv;
        gettimeofday(&tv, NULL);
        /* Before SNTP syncs, the clock sits in 1970; send 0 and let the server
         * stamp arrival time rather than writing a bogus 1970 reading. */
        reading.unix_ms = (tv.tv_sec > 1600000000)
                              ? (int64_t)tv.tv_sec * 1000 + tv.tv_usec / 1000
                              : 0;

        wifi_ap_record_t ap;
        if (esp_wifi_sta_get_ap_info(&ap) == ESP_OK) reading.rssi = ap.rssi;

        ESP_LOGI(TAG, "window: steps=%d walking=%d scored=%d mag_std=%.3f "
                      "cadence=%.0f P=%.4f (%.0f ms)",
                 r.n_steps_window, walking, scored, r.magnitude_std,
                 isfinite(r.cadence_spm) ? r.cadence_spm : 0.0,
                 scored ? reading.prob_faller : 0.0, elapsed_us / 1000.0);

        s_window_ready = false;   /* release the buffer back to imu_task */

        if (xQueueSend(s_upload_q, &reading, 0) != pdTRUE) {
            /* Queue full: drop the oldest so the dashboard keeps showing the
             * most recent minutes rather than a stale backlog. */
            gait_reading_t discard;
            xQueueReceive(s_upload_q, &discard, 0);
            xQueueSend(s_upload_q, &reading, 0);
            ESP_LOGW(TAG, "upload queue full, dropped oldest reading");
        }
    }
}

static void upload_task(void *arg)
{
    gait_reading_t reading;

    for (;;) {
        if (xQueueReceive(s_upload_q, &reading, portMAX_DELAY) != pdTRUE) continue;

        for (int attempt = 0; attempt < 3; attempt++) {
            if (!net_is_connected()) {
                vTaskDelay(pdMS_TO_TICKS(2000));
                continue;
            }
            if (net_post_reading(&reading) == ESP_OK) break;
            vTaskDelay(pdMS_TO_TICKS(1000 * (attempt + 1)));
        }
        /* On persistent failure the reading is dropped rather than retried
         * forever -- the queue in front of us is the buffer, and a stuck
         * reading would block everything behind it. */
    }
}

void app_main(void)
{
    ESP_LOGI(TAG, "GaitSense node %s starting", CONFIG_GAITSENSE_FW_VERSION);

    ESP_ERROR_CHECK(mpu6050_init());
    log_orientation_hint();

    if (net_start() != ESP_OK) {
        ESP_LOGE(TAG, "no network; continuing offline, readings will be buffered");
    }

    s_tick_sem = xSemaphoreCreateBinary();
    s_window_sem = xSemaphoreCreateBinary();
    s_upload_q = xQueueCreate(UPLOAD_QUEUE_LEN, sizeof(gait_reading_t));
    configASSERT(s_tick_sem && s_window_sem && s_upload_q);

    /* gait_extract() uses doubles throughout and the ESP32 FPU is single
     * precision, so double maths is emulated in software -- give the analysis
     * task a generous stack and keep it off the sampling core. */
    xTaskCreatePinnedToCore(imu_task, "imu", 4096, NULL, 6, NULL, 0);
    xTaskCreatePinnedToCore(analysis_task, "analysis", 8192, NULL, 4, NULL, 1);
    xTaskCreatePinnedToCore(upload_task, "upload", 6144, NULL, 3, NULL, 1);

    const esp_timer_create_args_t timer_args = {
        .callback = on_sample_tick,
        .dispatch_method = ESP_TIMER_ISR,
        .name = "sample_tick",
    };
    esp_timer_handle_t timer;
    ESP_ERROR_CHECK(esp_timer_create(&timer_args, &timer));
    ESP_ERROR_CHECK(esp_timer_start_periodic(timer, SAMPLE_PERIOD_US));

    ESP_LOGI(TAG, "sampling at %d Hz, one %.0f s window every %.0f s",
             (int)GAIT_FS, GAIT_WINDOW_SEC, GAIT_HOP_SAMPLES / GAIT_FS);
}
