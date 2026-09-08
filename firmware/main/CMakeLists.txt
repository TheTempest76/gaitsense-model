# The exported model is compiled straight out of the repo's models/ directory
# rather than copied in here, so that re-running `python src/export.py` after a
# retrain updates the firmware with no manual file shuffling.
set(GAITSENSE_MODEL_DIR "${CMAKE_CURRENT_LIST_DIR}/../../models")

idf_component_register(
    SRCS "main.c"
         "gait_features.c"
         "mpu6050.c"
         "net.c"
         "${GAITSENSE_MODEL_DIR}/model.c"
    INCLUDE_DIRS "." "${GAITSENSE_MODEL_DIR}"
    REQUIRES driver esp_wifi esp_http_client esp_netif nvs_flash esp_timer lwip
)

# model.c is one 250 KB function of nested if/else per tree. -Os keeps the
# flash cost down and the compiler's default warnings have nothing useful to
# say about generated code.
set_source_files_properties("${GAITSENSE_MODEL_DIR}/model.c"
    PROPERTIES COMPILE_OPTIONS "-Os;-w")
