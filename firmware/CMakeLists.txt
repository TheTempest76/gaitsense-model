cmake_minimum_required(VERSION 3.16)

# ESP-IDF v5.2 or newer: the MPU6050 driver uses the i2c_master API that
# replaced the deprecated driver/i2c.h in 5.2.
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(gaitsense-node)
