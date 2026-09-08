/** Shared shapes between the API routes, the DB layer, and the dashboard. */

/** One analysed 10 s window as posted by the ESP32 firmware (net.c). */
export interface IngestPayload {
  device_id: string;
  fw?: string | null;
  unix_ms?: number;
  window_sec?: number | null;

  steps_total?: number | null;
  steps_window?: number | null;

  walking: boolean;
  scored: boolean;
  prob_faller?: number | null;

  cadence_spm?: number | null;
  stride_time_mean?: number | null;
  magnitude_std?: number | null;
  rssi?: number | null;

  /** Model input vector, in models/feature_list.json order. Non-finite
   * values arrive as JSON null (see append_num in the firmware's net.c). */
  features?: (number | null)[] | null;
}

export interface DailyRow {
  day: string; // YYYY-MM-DD, local time
  steps: number;
  walking_sec: number;
  windows: number;
  scored_windows: number;
  cadence_spm: number | null;
  stride_time_mean: number | null;
  prob_median: number | null;
}

export interface WindowSummary {
  steps: number;
  windows: number;
  walking_sec: number;
  scored_windows: number;
  cadence_spm: number | null;
  stride_time_mean: number | null;
  prob_median: number | null;
  prob_n: number;
}

export interface RecentReading {
  ts_ms: number;
  walking: boolean;
  scored: boolean;
  prob_faller: number | null;
  cadence_spm: number | null;
  stride_time_mean: number | null;
  magnitude_std: number | null;
  steps_delta: number;
  steps_window: number | null;
  rssi: number | null;
}

export interface DeviceInfo {
  device_id: string;
  last_seen_ms: number;
  total_windows: number;
  steps_total: number | null;
  fw: string | null;
  rssi: number | null;
  ts_source: "device" | "server";
  online: boolean;
}

export type AssessmentBand =
  | "insufficient_data"
  | "resembles_non_fallers"
  | "inconclusive"
  | "resembles_fallers";

export interface ModelCard {
  what_it_measures: string;
  what_it_does_not_measure: string;
  accuracy: {
    auc_roc: number | null;
    sensitivity: number | null;
    specificity: number | null;
    n_subjects: number | null;
    chance_auc: number;
    clinically_useful_auc: number;
  };
  accuracy_plain: string;
  known_confound: string;
  not_medical_advice: string;
  trustworthy_instead: string;
}

export interface Assessment {
  band: AssessmentBand;
  label: string;
  detail: string;
  probability: number | null;
  n_scored_windows: number;
  model_card: ModelCard;
}

export interface SummaryResponse extends WindowSummary {
  window_hours: number;
  avg_daily_steps: number | null;
  assessment: Assessment;
  devices: DeviceInfo[];
}

export interface HistoryResponse {
  days: DailyRow[];
  bands: { low: number; high: number };
  model_card: ModelCard;
}

export interface Exercise {
  id: string;
  name: string;
  category: string;
  targets: string[];
  difficulty: number;
  dose: string;
  how: string[];
  why: string;
  reason?: string;
}

export interface ExercisesResponse {
  recommended: Exercise[];
  library: Exercise[];
  safety_note: string;
  basis: string;
}
