/* mpu6050.h -- minimal accelerometer-only MPU6050 driver.
 *
 * The gait model was trained on the three acceleration channels of the LTMM
 * lower-back sensor and nothing else, so the gyroscope is left powered but
 * unread. Configuration is fixed to match the training data: 100 Hz output,
 * +/-4 g range, on-chip low-pass at 44 Hz.
 *
 * Uses the ESP-IDF v5.2+ i2c_master driver (driver/i2c_master.h), not the
 * deprecated legacy driver/i2c.h API.
 */
#ifndef MPU6050_H
#define MPU6050_H

#include "esp_err.h"

/* Bring up I2C and configure the sensor for 100 Hz accelerometer sampling.
 * Returns ESP_ERR_NOT_FOUND if WHO_AM_I does not answer 0x68. */
esp_err_t mpu6050_init(void);

/* One accelerometer sample, converted to g. */
esp_err_t mpu6050_read_accel_g(float *ax, float *ay, float *az);

#endif /* MPU6050_H */
