export type NewDayPreviewItem = {
  id: string;
  title: string;
  previous_period_start: string;
  last_completion_period: string | null;
  repeat_cadence: string | null;
  repeat_every: number;
};

export type NewDayPreview = {
  profile_id: string;
  dailies: NewDayPreviewItem[];
};
