/* test_features.c -- host-side conformance harness for gait_features.c.
 *
 * Reads the fixture written by tools/gen_conformance_case.py, runs each window
 * through the firmware's feature extractor, and prints the results as JSON on
 * stdout. tools/check_conformance.py diffs that against the values produced by
 * the real training-time extractor in src/features.py.
 *
 * This is compiled for the host, not the ESP32 -- gait_features.c is kept free
 * of ESP-IDF dependencies precisely so this is possible.
 *
 * It also runs each scoreable window through the exported model, so the check
 * covers the whole on-device chain -- raw samples -> features -> P(faller) --
 * rather than the feature stage alone.
 *
 * Build + run (no host toolchain needed, see firmware/README.md):
 *   docker run --rm -v "$(pwd):/w" -w /w gcc:latest bash -c \
 *     "gcc -O2 -I firmware/main -I models -o /tmp/t \
 *        firmware/main/gait_features.c firmware/test/test_features.c models/model.c -lm \
 *      && /tmp/t firmware/test/cases.txt"
 */

#include <stdio.h>
#include <stdlib.h>
#include <math.h>

#include "gait_features.h"
#include "model.h"

static float g_v[GAIT_WINDOW_SAMPLES];
static float g_ml[GAIT_WINDOW_SAMPLES];
static float g_ap[GAIT_WINDOW_SAMPLES];

static int read_axis(FILE *f, float *dst)
{
    for (int i = 0; i < GAIT_WINDOW_SAMPLES; i++) {
        double x;
        if (fscanf(f, "%lf", &x) != 1) return 0;
        dst[i] = (float)x;
    }
    return 1;
}

static void print_num(double x)
{
    if (isfinite(x)) printf("%.17g", x);
    else             printf("null");
}

int main(int argc, char **argv)
{
    if (argc < 2) {
        fprintf(stderr, "usage: %s cases.txt\n", argv[0]);
        return 2;
    }

    FILE *f = fopen(argv[1], "r");
    if (!f) {
        fprintf(stderr, "cannot open %s\n", argv[1]);
        return 2;
    }

    int n_cases = 0;
    if (fscanf(f, "%d", &n_cases) != 1) {
        fprintf(stderr, "bad fixture header\n");
        fclose(f);
        return 2;
    }

    printf("[\n");
    for (int c = 0; c < n_cases; c++) {
        char name[128];
        if (fscanf(f, "%127s", name) != 1) {
            fprintf(stderr, "case %d: missing name\n", c);
            fclose(f);
            return 2;
        }
        if (!read_axis(f, g_v) || !read_axis(f, g_ml) || !read_axis(f, g_ap)) {
            fprintf(stderr, "case %s: truncated signal\n", name);
            fclose(f);
            return 2;
        }

        gait_window_result_t r;
        gait_extract(g_v, g_ml, g_ap, &r);

        printf("  {\"name\": \"%s\", \"features\": [", name);
        for (int i = 0; i < GAIT_N_FEATURES; i++) {
            if (i) printf(", ");
            print_num(r.features[i]);
        }
        printf("], \"n_steps_window\": %d, \"n_steps_fresh\": %d, "
               "\"features_valid\": %s, \"cadence_spm\": ",
               r.n_steps_window, r.n_steps_fresh,
               r.features_valid ? "true" : "false");
        print_num(r.cadence_spm);
        printf(", \"stride_time_mean\": ");
        print_num(r.stride_time_mean);

        /* Only scoreable windows get a probability -- see the features_valid
         * note in gait_features.h for why NaN must never reach score(). */
        printf(", \"prob_faller\": ");
        if (r.features_valid) {
            double out[2];
            score(r.features, out);
            print_num(out[1]);
        } else {
            printf("null");
        }
        printf("}%s\n", c == n_cases - 1 ? "" : ",");
    }
    printf("]\n");

    fclose(f);
    return 0;
}
