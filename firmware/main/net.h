/* net.h -- Wi-Fi station bring-up and reading upload for the GaitSense node. */
#ifndef NET_H
#define NET_H

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"
#include "gait_features.h"

/* One analysed window, as posted to the website's /api/ingest. */
typedef struct {
    int64_t  unix_ms;          /* 0 if SNTP has not synced yet; the server then
                                * substitutes its own arrival time. */
    uint32_t steps_total;      /* cumulative since boot */
    int      steps_window;
    bool     walking;          /* passed the movement gate */
    bool     scored;           /* walking AND all features finite */
    double   prob_faller;      /* valid only when scored */
    double   cadence_spm;
    double   stride_time_mean;
    double   magnitude_std;
    double   features[GAIT_N_FEATURES];
    int      rssi;
} gait_reading_t;

/* Connect to the configured AP and start SNTP. Blocks until the first
 * connection succeeds or the retry limit is hit. */
esp_err_t net_start(void);

bool net_is_connected(void);

/* The device identity reported to the server: "gaitsense-<mac suffix>". */
const char *net_device_id(void);

/* POST one reading to CONFIG_GAITSENSE_SERVER_URL "/api/ingest". */
esp_err_t net_post_reading(const gait_reading_t *r);

#endif /* NET_H */
