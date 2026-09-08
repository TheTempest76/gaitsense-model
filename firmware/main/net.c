#include "net.h"

#include <math.h>
#include <stdio.h>
#include <string.h>
#include <sys/time.h>

#include "esp_event.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_netif_sntp.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "nvs_flash.h"
#include "sdkconfig.h"

static const char *TAG = "net";

#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAILED_BIT    BIT1
#define MAX_RETRIES        10

static EventGroupHandle_t s_events;
static int s_retries;
static char s_device_id[32];
static volatile bool s_connected;

static void on_wifi_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        s_connected = false;
        if (s_retries < MAX_RETRIES) {
            s_retries++;
            ESP_LOGW(TAG, "disconnected, retry %d/%d", s_retries, MAX_RETRIES);
            esp_wifi_connect();
        } else {
            xEventGroupSetBits(s_events, WIFI_FAILED_BIT);
        }
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        const ip_event_got_ip_t *e = (const ip_event_got_ip_t *)data;
        ESP_LOGI(TAG, "got ip " IPSTR, IP2STR(&e->ip_info.ip));
        s_retries = 0;
        s_connected = true;
        xEventGroupSetBits(s_events, WIFI_CONNECTED_BIT);
    }
}

const char *net_device_id(void)
{
    if (s_device_id[0] == '\0') {
        uint8_t mac[6] = {0};
        esp_read_mac(mac, ESP_MAC_WIFI_STA);
        snprintf(s_device_id, sizeof(s_device_id), "gaitsense-%02x%02x%02x",
                 mac[3], mac[4], mac[5]);
    }
    return s_device_id;
}

bool net_is_connected(void)
{
    return s_connected;
}

esp_err_t net_start(void)
{
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(err);

    s_events = xEventGroupCreate();
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    const wifi_init_config_t init_cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&init_cfg));

    ESP_ERROR_CHECK(esp_event_handler_instance_register(
        WIFI_EVENT, ESP_EVENT_ANY_ID, on_wifi_event, NULL, NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(
        IP_EVENT, IP_EVENT_STA_GOT_IP, on_wifi_event, NULL, NULL));

    wifi_config_t wifi_cfg = {0};
    strncpy((char *)wifi_cfg.sta.ssid, CONFIG_GAITSENSE_WIFI_SSID,
            sizeof(wifi_cfg.sta.ssid) - 1);
    strncpy((char *)wifi_cfg.sta.password, CONFIG_GAITSENSE_WIFI_PASSWORD,
            sizeof(wifi_cfg.sta.password) - 1);

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_cfg));

    /* The radio is the dominant power draw here and the sampling task must not
     * be starved, so keep modem sleep on -- uploads are one small POST every
     * 5 s, which tolerates the extra wake latency fine. */
    ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_MIN_MODEM));
    ESP_ERROR_CHECK(esp_wifi_start());

    ESP_LOGI(TAG, "device id %s, connecting to SSID \"%s\"",
             net_device_id(), CONFIG_GAITSENSE_WIFI_SSID);

    const EventBits_t bits = xEventGroupWaitBits(
        s_events, WIFI_CONNECTED_BIT | WIFI_FAILED_BIT, pdFALSE, pdFALSE,
        pdMS_TO_TICKS(30000));

    if (!(bits & WIFI_CONNECTED_BIT)) {
        ESP_LOGE(TAG, "could not join \"%s\"", CONFIG_GAITSENSE_WIFI_SSID);
        return ESP_FAIL;
    }

    /* Timestamps come from the device so that readings buffered while the
     * server is unreachable still land at the right point in history. */
    esp_sntp_config_t sntp_cfg = ESP_NETIF_SNTP_DEFAULT_CONFIG(CONFIG_GAITSENSE_SNTP_SERVER);
    esp_netif_sntp_init(&sntp_cfg);
    if (esp_netif_sntp_sync_wait(pdMS_TO_TICKS(10000)) != ESP_OK) {
        ESP_LOGW(TAG, "SNTP did not sync; the server will timestamp on arrival");
    }
    return ESP_OK;
}

/* JSON needs a literal null for a non-finite double -- printf would emit "nan"
 * or "inf", neither of which is valid JSON, and a strict parser would reject
 * the whole payload. */
static int append_num(char *buf, size_t cap, size_t used, double v)
{
    if (!isfinite(v)) return snprintf(buf + used, cap - used, "null");
    return snprintf(buf + used, cap - used, "%.9g", v);
}

esp_err_t net_post_reading(const gait_reading_t *r)
{
    char url[192];
    snprintf(url, sizeof(url), "%s/api/ingest", CONFIG_GAITSENSE_SERVER_URL);

    char body[1024];
    size_t n = 0;

    n += snprintf(body + n, sizeof(body) - n,
                  "{\"device_id\":\"%s\",\"fw\":\"%s\",\"unix_ms\":%lld,"
                  "\"window_sec\":%.1f,\"steps_total\":%lu,\"steps_window\":%d,"
                  "\"walking\":%s,\"scored\":%s,\"rssi\":%d,",
                  net_device_id(), CONFIG_GAITSENSE_FW_VERSION,
                  (long long)r->unix_ms, GAIT_WINDOW_SEC,
                  (unsigned long)r->steps_total, r->steps_window,
                  r->walking ? "true" : "false",
                  r->scored ? "true" : "false", r->rssi);

    n += snprintf(body + n, sizeof(body) - n, "\"prob_faller\":");
    n += append_num(body, sizeof(body), n, r->scored ? r->prob_faller : NAN);

    n += snprintf(body + n, sizeof(body) - n, ",\"cadence_spm\":");
    n += append_num(body, sizeof(body), n, r->cadence_spm);

    n += snprintf(body + n, sizeof(body) - n, ",\"stride_time_mean\":");
    n += append_num(body, sizeof(body), n, r->stride_time_mean);

    n += snprintf(body + n, sizeof(body) - n, ",\"magnitude_std\":");
    n += append_num(body, sizeof(body), n, r->magnitude_std);

    n += snprintf(body + n, sizeof(body) - n, ",\"features\":[");
    for (int i = 0; i < GAIT_N_FEATURES; i++) {
        if (i) n += snprintf(body + n, sizeof(body) - n, ",");
        n += append_num(body, sizeof(body), n, r->features[i]);
    }
    n += snprintf(body + n, sizeof(body) - n, "]}");

    if (n >= sizeof(body)) {
        ESP_LOGE(TAG, "payload truncated (%u bytes)", (unsigned)n);
        return ESP_ERR_INVALID_SIZE;
    }

    esp_http_client_config_t cfg = {
        .url = url,
        .method = HTTP_METHOD_POST,
        .timeout_ms = 8000,
    };
    esp_http_client_handle_t client = esp_http_client_init(&cfg);
    if (!client) return ESP_FAIL;

    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_header(client, "X-Device-Token", CONFIG_GAITSENSE_DEVICE_TOKEN);
    esp_http_client_set_post_field(client, body, (int)n);

    esp_err_t err = esp_http_client_perform(client);
    if (err == ESP_OK) {
        const int status = esp_http_client_get_status_code(client);
        if (status < 200 || status >= 300) {
            ESP_LOGW(TAG, "server returned HTTP %d", status);
            err = ESP_FAIL;
        }
    } else {
        ESP_LOGW(TAG, "POST failed: %s", esp_err_to_name(err));
    }
    esp_http_client_cleanup(client);
    return err;
}
