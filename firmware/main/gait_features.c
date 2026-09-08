/* gait_features.c -- C port of the 10 deployed features from src/features.py.
 *
 * Every routine here is a deliberate reimplementation of a specific SciPy call
 * used during training. Where SciPy's behaviour is non-obvious (filtfilt
 * padding, find_peaks filter ordering, Welch scaling) the matching SciPy
 * semantics are noted inline, because getting these subtly wrong produces
 * features that look plausible but sit in a different distribution from the
 * ones the model was trained on.
 *
 * Verified against the Python reference by firmware/test/test_features.c --
 * see firmware/README.md for how to run it.
 */

#include "gait_features.h"

#include <math.h>
#include <string.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

/* --------------------------------------------------------------------------
 * Butterworth bandpass, order 4, 0.5-3.5 Hz at fs = 100 Hz.
 *
 * Generated once with scipy and embedded rather than designed at runtime:
 *   b, a = scipy.signal.butter(4, [0.5/50, 3.5/50], btype="band")
 *   zi   = scipy.signal.lfilter_zi(b, a)
 * A bandpass of order 4 is an order-8 filter, hence 9 taps and 8 state slots.
 * -------------------------------------------------------------------------- */

#define BP_ORDER  8
#define BP_PADLEN 27   /* scipy filtfilt default: 3 * max(len(a), len(b)) */

static const double BP_B[BP_ORDER + 1] = {
    6.238698354847942e-05, 0.0, -0.00024954793419391767,
    0.0, 0.0003743219012908765, 0.0,
    -0.00024954793419391767, 0.0, 6.238698354847942e-05,
};

static const double BP_A[BP_ORDER + 1] = {
    1.0, -7.48178951738894, 24.525732963411542,
    -46.0095797194012, 54.02747696600529, -40.66596832551581,
    19.160431859056946, -5.166839031931832, 0.6105348075612238,
};

static const double BP_ZI[BP_ORDER] = {
    -6.238654618055358e-05, -6.238981847531648e-05, 0.00018716884248755745,
    0.00018714871937310597, -0.00018714955203223113, -0.00018716733802245082,
    6.23889763298076e-05, 6.238671652013697e-05,
};

#define EXT_SAMPLES (GAIT_WINDOW_SAMPLES + 2 * BP_PADLEN)

/* Static scratch: ~25 KB of .bss, which is cheaper and far safer than putting
 * 1000-element double arrays on an ESP-IDF task stack. gait_extract() is not
 * reentrant as a result -- call it from one task only. */
static double s_ext[EXT_SAMPLES];
static double s_tmp[EXT_SAMPLES];
static double s_filt[GAIT_WINDOW_SAMPLES];
static double s_work[GAIT_WINDOW_SAMPLES];

/* scipy.signal.lfilter in direct form II transposed, with initial conditions.
 * Writes to y and consumes z as the running state. */
static void lfilter_zi_run(const double *x, int n, double *y, double *z)
{
    for (int i = 0; i < n; i++) {
        const double xi = x[i];
        const double yi = BP_B[0] * xi + z[0];
        y[i] = yi;
        for (int j = 0; j < BP_ORDER - 1; j++) {
            z[j] = BP_B[j + 1] * xi + z[j + 1] - BP_A[j + 1] * yi;
        }
        z[BP_ORDER - 1] = BP_B[BP_ORDER] * xi - BP_A[BP_ORDER] * yi;
    }
}

static void reverse_in_place(double *x, int n)
{
    for (int i = 0, j = n - 1; i < j; i++, j--) {
        const double t = x[i];
        x[i] = x[j];
        x[j] = t;
    }
}

void gait_bandpass_filtfilt(const double *x, int n, double *y)
{
    /* scipy's _odd_ext(x, padlen) reflects about the endpoint values:
     *   left  = 2*x[0]   - x[padlen:0:-1]
     *   right = 2*x[n-1] - x[-2:-(padlen+2):-1]                          */
    const int p = BP_PADLEN;
    const int ext_n = n + 2 * p;

    for (int i = 0; i < p; i++) {
        s_ext[i] = 2.0 * x[0] - x[p - i];
    }
    memcpy(s_ext + p, x, (size_t)n * sizeof(double));
    for (int i = 0; i < p; i++) {
        s_ext[p + n + i] = 2.0 * x[n - 1] - x[n - 2 - i];
    }

    double z[BP_ORDER];

    /* forward pass, initial state scaled by the first sample */
    for (int i = 0; i < BP_ORDER; i++) z[i] = BP_ZI[i] * s_ext[0];
    lfilter_zi_run(s_ext, ext_n, s_tmp, z);

    /* backward pass over the reversed forward result */
    reverse_in_place(s_tmp, ext_n);
    for (int i = 0; i < BP_ORDER; i++) z[i] = BP_ZI[i] * s_tmp[0];
    lfilter_zi_run(s_tmp, ext_n, s_ext, z);
    reverse_in_place(s_ext, ext_n);

    memcpy(y, s_ext + p, (size_t)n * sizeof(double));
}

/* --------------------------------------------------------------------------
 * Peak picking -- scipy.signal.find_peaks(x, distance, prominence)
 *
 * SciPy applies its filters in a fixed order and the order matters here:
 * distance is applied BEFORE prominence, and prominence is then measured
 * against the full original signal rather than against the surviving peaks.
 * Reordering these changes which peaks survive.
 * -------------------------------------------------------------------------- */

#define MAX_PEAKS 256

/* scipy._peak_finding_utils._local_maxima_1d, including plateau midpoints. */
static int local_maxima_1d(const double *x, int n, int *out, int max_out)
{
    int count = 0;
    int i = 1;
    const int i_max = n - 1;

    while (i < i_max) {
        if (x[i - 1] < x[i]) {
            int i_ahead = i + 1;
            while (i_ahead < i_max && x[i_ahead] == x[i]) i_ahead++;
            if (x[i_ahead] < x[i]) {
                if (count < max_out) out[count++] = (i + i_ahead - 1) / 2;
                i = i_ahead;
            }
        }
        i++;
    }
    return count;
}

/* scipy._peak_finding_utils._select_by_peak_distance: walk the peaks highest
 * first, suppressing any neighbour closer than distance samples. */
static void select_by_peak_distance(const int *peaks, int n_peaks,
                                    const double *x, int distance, char *keep)
{
    int order[MAX_PEAKS];

    for (int i = 0; i < n_peaks; i++) { keep[i] = 1; order[i] = i; }

    /* insertion sort by peak height, ascending. n_peaks is small (<= ~40 for a
     * 10 s walking window), so this beats anything cleverer. */
    for (int i = 1; i < n_peaks; i++) {
        const int key = order[i];
        int j = i - 1;
        while (j >= 0 && x[peaks[order[j]]] > x[peaks[key]]) {
            order[j + 1] = order[j];
            j--;
        }
        order[j + 1] = key;
    }

    for (int i = n_peaks - 1; i >= 0; i--) {
        const int j = order[i];
        if (!keep[j]) continue;
        for (int k = j - 1; k >= 0 && peaks[j] - peaks[k] < distance; k--) keep[k] = 0;
        for (int k = j + 1; k < n_peaks && peaks[k] - peaks[j] < distance; k++) keep[k] = 0;
    }
}

/* scipy._peak_finding_utils._peak_prominences with wlen=None. */
static double peak_prominence(const double *x, int n, int peak_idx)
{
    const double peak = x[peak_idx];
    double left_min = peak, right_min = peak;

    for (int i = peak_idx; i >= 0 && x[i] <= peak; i--) {
        if (x[i] < left_min) left_min = x[i];
    }
    for (int i = peak_idx; i < n && x[i] <= peak; i++) {
        if (x[i] < right_min) right_min = x[i];
    }
    return peak - (left_min > right_min ? left_min : right_min);
}

int gait_detect_steps(const double *filt, int n, int *peaks_out, int max_peaks)
{
    int cand[MAX_PEAKS];
    char keep[MAX_PEAKS];

    if (n < (int)GAIT_FS) return 0;   /* features.py: need at least ~1 s */

    const int n_cand = local_maxima_1d(filt, n, cand, MAX_PEAKS);
    if (n_cand == 0) return 0;

    /* min_distance = max(int(0.25 * fs), 1) -- caps cadence at 240 steps/min */
    int distance = (int)(0.25 * GAIT_FS);
    if (distance < 1) distance = 1;
    select_by_peak_distance(cand, n_cand, filt, distance, keep);

    /* prominence = 0.15 * np.std(filt), and np.std defaults to ddof=0. When
     * the signal is flat the Python passes prominence=None (no filtering). */
    double mean = 0.0;
    for (int i = 0; i < n; i++) mean += filt[i];
    mean /= n;
    double var = 0.0;
    for (int i = 0; i < n; i++) { const double d = filt[i] - mean; var += d * d; }
    const double sd = sqrt(var / n);
    const bool use_prominence = sd > 0.0;
    const double min_prom = 0.15 * sd;

    int count = 0;
    for (int i = 0; i < n_cand; i++) {
        if (!keep[i]) continue;
        if (use_prominence && peak_prominence(filt, n, cand[i]) < min_prom) continue;
        if (count < max_peaks) peaks_out[count++] = cand[i];
    }
    return count;
}

/* --------------------------------------------------------------------------
 * Spectral helpers.
 *
 * Both users below need only a handful of DFT bins out of a 400- or 1000-point
 * transform, so a direct partial DFT (O(bins * n)) is both simpler and cheaper
 * here than dragging in a general mixed-radix FFT -- 1000 is not a power of
 * two, and the worst case is ~5e5 multiply-adds per window.
 * -------------------------------------------------------------------------- */

static void dft_bin(const double *x, int n, int k, double *re, double *im)
{
    const double w = -2.0 * M_PI * (double)k / (double)n;
    double sr = 0.0, si = 0.0;
    for (int i = 0; i < n; i++) {
        const double ang = w * (double)i;
        sr += x[i] * cos(ang);
        si += x[i] * sin(ang);
    }
    *re = sr;
    *im = si;
}

/* scipy.signal.welch(x, fs, nperseg=min(n, fs*4)) with all other defaults:
 * periodic Hann window, 50% overlap, detrend by segment mean, density scaling,
 * one-sided (non-DC, non-Nyquist bins doubled), averaged with the mean.
 * Returns the plain SUM of PSD bins with lo <= f < hi -- features.py sums the
 * bins rather than integrating, so no bin-width factor is applied. */
double gait_welch_band_power(const double *x, int n, double lo, double hi)
{
    if (n < 8) return NAN;

    int nperseg = (int)(GAIT_FS * 4.0);
    if (nperseg > n) nperseg = n;
    const int noverlap = nperseg / 2;
    const int step = nperseg - noverlap;
    const int n_seg = (n - noverlap) / step;
    if (n_seg < 1) return NAN;

    const int n_bins = nperseg / 2 + 1;
    const double df = GAIT_FS / (double)nperseg;

    /* periodic Hann, matching scipy.signal.get_window("hann", N) */
    double wsum2 = 0.0;
    for (int i = 0; i < nperseg; i++) {
        const double wi = 0.5 - 0.5 * cos(2.0 * M_PI * (double)i / (double)nperseg);
        s_work[i] = wi;
        wsum2 += wi * wi;
    }
    if (wsum2 <= 0.0) return NAN;
    const double scale = 1.0 / (GAIT_FS * wsum2);

    double total = 0.0;
    bool any_bin = false;
    bool any_power = false;

    for (int k = 0; k < n_bins; k++) {
        const double f = (double)k * df;
        if (!(f >= lo && f < hi)) continue;
        any_bin = true;

        double acc = 0.0;
        for (int s = 0; s < n_seg; s++) {
            const double *seg = x + s * step;

            double segmean = 0.0;                    /* detrend='constant' */
            for (int i = 0; i < nperseg; i++) segmean += seg[i];
            segmean /= nperseg;

            const double w = -2.0 * M_PI * (double)k / (double)nperseg;
            double sr = 0.0, si = 0.0;
            for (int i = 0; i < nperseg; i++) {
                const double xv = (seg[i] - segmean) * s_work[i];
                const double ang = w * (double)i;
                sr += xv * cos(ang);
                si += xv * sin(ang);
            }

            double p = (sr * sr + si * si) * scale;
            if (k != 0 && !(nperseg % 2 == 0 && k == nperseg / 2)) p *= 2.0;
            acc += p;
        }
        const double binpow = acc / (double)n_seg;
        if (binpow > 0.0) any_power = true;
        total += binpow;
    }

    /* features.py returns NaN when the PSD is all-zero, and NaN when the band
     * mask selects no bins at all. */
    if (!any_bin) return NAN;
    if (!any_power) return NAN;
    return total;
}

/* Menz/Latt harmonic ratio for the mediolateral axis.
 * ML acceleration alternates sign step-to-step, so its fundamental sits on the
 * ODD harmonics of the stride frequency -- hence odd/even here, the inverse of
 * the V and AP convention (Kobsar et al. 2020). */
#define N_HARMONICS 10
#define HR_SEARCH   2   /* +/- 2 FFT bins tolerance around each harmonic */

double gait_harmonic_ratio_ml(const double *ml, int n, double stride_time)
{
    if (!isfinite(stride_time) || stride_time <= 0.0) return NAN;
    if (n < (int)GAIT_FS) return NAN;

    const double f0 = 1.0 / stride_time;
    if (f0 * (double)N_HARMONICS >= GAIT_FS / 2.0) return NAN;

    const int spec_len = n / 2 + 1;
    const double bin_width = GAIT_FS / (double)n;
    if (!(bin_width > 0.0)) return NAN;

    double mean = 0.0;
    for (int i = 0; i < n; i++) mean += ml[i];
    mean /= n;
    for (int i = 0; i < n; i++) s_work[i] = ml[i] - mean;

    double harmonics[N_HARMONICS];
    int n_h = 0;

    for (int k = 1; k <= N_HARMONICS; k++) {
        const int idx = (int)lround((double)k * f0 / bin_width);
        if (idx - HR_SEARCH < 0 || idx + HR_SEARCH >= spec_len) break;

        double best = -1.0;
        for (int b = idx - HR_SEARCH; b <= idx + HR_SEARCH; b++) {
            double re, im;
            dft_bin(s_work, n, b, &re, &im);
            const double mag = sqrt(re * re + im * im);
            if (mag > best) best = mag;
        }
        harmonics[n_h++] = best;
    }

    if (n_h < 4) return NAN;

    double odd = 0.0, even = 0.0;
    for (int i = 0; i < n_h; i++) {
        if (i % 2 == 0) odd += harmonics[i];   /* harmonics[0] is the 1st harmonic */
        else            even += harmonics[i];
    }
    if (even <= 0.0) return NAN;
    return odd / even;
}

/* --------------------------------------------------------------------------
 * Plain statistics
 * -------------------------------------------------------------------------- */

static double vec_mean(const double *x, int n)
{
    double s = 0.0;
    for (int i = 0; i < n; i++) s += x[i];
    return s / n;
}

static double vec_rms(const double *x, int n)
{
    double s = 0.0;
    for (int i = 0; i < n; i++) s += x[i] * x[i];
    return sqrt(s / n);
}

/* scipy.stats.skew with the default bias=True: m3 / m2**1.5.
 *
 * SciPy guards against catastrophic cancellation on a near-constant signal and
 * returns NaN rather than a meaningless ratio:
 *     zero = m2 <= (np.finfo(float64).resolution * mean)**2
 *     vals = np.where(zero, np.nan, m3 / m2**1.5)
 * Reproducing that guard matters here -- a still, non-walking window is exactly
 * the near-constant case, and NaN is what marks it as not scoreable. */
#define NP_FLOAT64_RESOLUTION 1e-15

static double vec_skew(const double *x, int n)
{
    if (n < 3) return NAN;
    const double m = vec_mean(x, n);
    double m2 = 0.0, m3 = 0.0;
    for (int i = 0; i < n; i++) {
        const double d = x[i] - m;
        const double d2 = d * d;
        m2 += d2;
        m3 += d2 * d;
    }
    m2 /= n;
    m3 /= n;

    const double tol = NP_FLOAT64_RESOLUTION * m;
    if (m2 <= tol * tol) return NAN;
    return m3 / pow(m2, 1.5);
}

/* --------------------------------------------------------------------------
 * Top level
 * -------------------------------------------------------------------------- */

static double s_v[GAIT_WINDOW_SAMPLES];
static double s_ml[GAIT_WINDOW_SAMPLES];
static double s_mag[GAIT_WINDOW_SAMPLES];

void gait_extract(const float *v, const float *ml, const float *ap,
                  gait_window_result_t *out)
{
    const int n = GAIT_WINDOW_SAMPLES;

    memset(out, 0, sizeof(*out));
    for (int i = 0; i < GAIT_N_FEATURES; i++) out->features[i] = NAN;
    out->cadence_spm = NAN;
    out->stride_time_mean = NAN;

    double ap_sum = 0.0;
    for (int i = 0; i < n; i++) {
        const double vv = (double)v[i];
        const double mm = (double)ml[i];
        const double aa = (double)ap[i];
        s_v[i] = vv;
        s_ml[i] = mm;
        s_mag[i] = sqrt(vv * vv + mm * mm + aa * aa);
        ap_sum += aa;
    }

    /* --- step detection on the bandpassed vertical axis ------------------ */
    gait_bandpass_filtfilt(s_v, n, s_filt);

    int peaks[MAX_PEAKS];
    const int n_peaks = gait_detect_steps(s_filt, n, peaks, MAX_PEAKS);
    out->n_steps_window = n_peaks;

    int fresh = 0;
    for (int i = 0; i < n_peaks; i++) if (peaks[i] >= GAIT_HOP_SAMPLES) fresh++;
    out->n_steps_fresh = fresh;

    double step_time_mean = NAN;
    double stride_time_mean = NAN;

    if (n_peaks >= GAIT_MIN_STEPS_FOR_TEMPORAL) {
        double s = 0.0;
        for (int i = 1; i < n_peaks; i++) s += (double)(peaks[i] - peaks[i - 1]) / GAIT_FS;
        step_time_mean = s / (double)(n_peaks - 1);
        out->cadence_spm = 60.0 * (double)n_peaks / GAIT_WINDOW_SEC;

        if (n_peaks >= 5) {
            double ss = 0.0;
            const int n_stride = n_peaks - 2;
            for (int i = 0; i < n_stride; i++) {
                ss += (double)(peaks[i + 2] - peaks[i]) / GAIT_FS;
            }
            stride_time_mean = ss / (double)n_stride;
        }
    }
    out->stride_time_mean = stride_time_mean;

    /* --- the 10 deployed features, in models/model.h order --------------- */
    out->features[0] = vec_mean(s_v, n);                                  /* vertical_mean */
    out->features[1] = gait_welch_band_power(s_v, n, 3.0, 8.0);           /* vertical_power_3_8 */
    out->features[2] = vec_mean(s_ml, n);                                 /* ml_mean */
    out->features[3] = vec_rms(s_ml, n);                                  /* ml_rms */
    out->features[4] = ap_sum / (double)n;                                /* ap_mean */
    out->features[5] = vec_mean(s_mag, n);                                /* magnitude_mean */
    out->features[6] = gait_harmonic_ratio_ml(s_ml, n, stride_time_mean); /* harmonic_ratio_ml */
    out->features[7] = vec_rms(s_mag, n);                                 /* magnitude_rms */
    out->features[8] = vec_skew(s_v, n);                                  /* vertical_skew */
    out->features[9] = step_time_mean;                                    /* step_time_mean */

    /* Movement energy for the walking gate (not a model input). Derived from
     * the two magnitude features already computed: var = E[x^2] - E[x]^2,
     * clamped because cancellation can push it slightly negative. */
    {
        const double mag_mean = out->features[5];
        const double mag_rms = out->features[7];
        const double var = mag_rms * mag_rms - mag_mean * mag_mean;
        out->magnitude_std = sqrt(var > 0.0 ? var : 0.0);
    }

    bool valid = true;
    for (int i = 0; i < GAIT_N_FEATURES; i++) {
        if (!isfinite(out->features[i])) { valid = false; break; }
    }
    out->features_valid = valid;
}
