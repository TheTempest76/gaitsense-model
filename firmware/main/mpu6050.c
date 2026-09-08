#include "mpu6050.h"

#include "driver/i2c_master.h"
#include "esp_check.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "sdkconfig.h"

static const char *TAG = "mpu6050";

#define MPU6050_ADDR        0x68

#define REG_SMPLRT_DIV      0x19
#define REG_CONFIG          0x1A
#define REG_ACCEL_CONFIG    0x1C
#define REG_ACCEL_XOUT_H    0x3B
#define REG_PWR_MGMT_1      0x6B
#define REG_WHO_AM_I        0x75

/* +/-4 g full scale -> 8192 LSB per g. Chosen over the +/-2 g default because
 * heel strike at the lower back overshoots 2 g and would clip; the LTMM
 * recordings are in g, so nothing downstream cares about the range as long as
 * it does not saturate. */
#define ACCEL_FS_SEL_4G     0x08
#define ACCEL_LSB_PER_G     8192.0f

static i2c_master_bus_handle_t s_bus;
static i2c_master_dev_handle_t s_dev;

static esp_err_t write_reg(uint8_t reg, uint8_t val)
{
    const uint8_t buf[2] = {reg, val};
    return i2c_master_transmit(s_dev, buf, sizeof(buf), 1000);
}

static esp_err_t read_regs(uint8_t reg, uint8_t *dst, size_t len)
{
    return i2c_master_transmit_receive(s_dev, &reg, 1, dst, len, 1000);
}

esp_err_t mpu6050_init(void)
{
    const i2c_master_bus_config_t bus_cfg = {
        .i2c_port = I2C_NUM_0,
        .sda_io_num = CONFIG_GAITSENSE_I2C_SDA_GPIO,
        .scl_io_num = CONFIG_GAITSENSE_I2C_SCL_GPIO,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = true,
    };
    ESP_RETURN_ON_ERROR(i2c_new_master_bus(&bus_cfg, &s_bus), TAG, "i2c bus");

    const i2c_device_config_t dev_cfg = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = MPU6050_ADDR,
        .scl_speed_hz = 400000,
    };
    ESP_RETURN_ON_ERROR(i2c_master_bus_add_device(s_bus, &dev_cfg, &s_dev), TAG, "i2c dev");

    uint8_t who = 0;
    ESP_RETURN_ON_ERROR(read_regs(REG_WHO_AM_I, &who, 1), TAG, "who_am_i");
    if (who != 0x68) {
        ESP_LOGE(TAG, "WHO_AM_I = 0x%02x, expected 0x68 -- wrong device or bad wiring", who);
        return ESP_ERR_NOT_FOUND;
    }

    /* Reset, then select the X-gyro PLL as clock source: more stable than the
     * internal 8 MHz oscillator, and sample-rate accuracy feeds straight into
     * the step-timing features. */
    ESP_RETURN_ON_ERROR(write_reg(REG_PWR_MGMT_1, 0x80), TAG, "reset");
    vTaskDelay(pdMS_TO_TICKS(100));
    ESP_RETURN_ON_ERROR(write_reg(REG_PWR_MGMT_1, 0x01), TAG, "wake");
    vTaskDelay(pdMS_TO_TICKS(10));

    /* DLPF_CFG = 3: 44 Hz accelerometer bandwidth. Comfortably above the
     * 0.5-3.5 Hz step band and the 3-8 Hz feature band, while suppressing the
     * high-frequency content that would otherwise alias into a 100 Hz stream. */
    ESP_RETURN_ON_ERROR(write_reg(REG_CONFIG, 0x03), TAG, "dlpf");

    /* With DLPF enabled the gyro output rate is 1 kHz, so divider 9 gives
     * 1000 / (1 + 9) = 100 Hz -- matching FS_EXPECTED in src/features.py. */
    ESP_RETURN_ON_ERROR(write_reg(REG_SMPLRT_DIV, 9), TAG, "smplrt");
    ESP_RETURN_ON_ERROR(write_reg(REG_ACCEL_CONFIG, ACCEL_FS_SEL_4G), TAG, "accel_cfg");

    ESP_LOGI(TAG, "ready: 100 Hz, +/-4 g, DLPF 44 Hz, SDA=%d SCL=%d",
             CONFIG_GAITSENSE_I2C_SDA_GPIO, CONFIG_GAITSENSE_I2C_SCL_GPIO);
    return ESP_OK;
}

esp_err_t mpu6050_read_accel_g(float *ax, float *ay, float *az)
{
    uint8_t raw[6];
    ESP_RETURN_ON_ERROR(read_regs(REG_ACCEL_XOUT_H, raw, sizeof(raw)), TAG, "read accel");

    const int16_t x = (int16_t)((raw[0] << 8) | raw[1]);
    const int16_t y = (int16_t)((raw[2] << 8) | raw[3]);
    const int16_t z = (int16_t)((raw[4] << 8) | raw[5]);

    *ax = (float)x / ACCEL_LSB_PER_G;
    *ay = (float)y / ACCEL_LSB_PER_G;
    *az = (float)z / ACCEL_LSB_PER_G;
    return ESP_OK;
}
