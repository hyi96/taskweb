export type NewDayPreviewItem = {
  id: string;
  title: string;
  previous_period_start: string;
  last_completion_period: string | null;
  repeat_cadence: string | null;
  repeat_every: number;
  current_streak: number;
  missed_period_count: number;
  completion_gold_delta: string;
  streak_protection_cost: string;
  protection_cost: string;
  can_protect: boolean;
};

export type NewDayPreview = {
  profile_id: string;
  dailies: NewDayPreviewItem[];
};
