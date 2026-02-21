export type LogEntry = {
  id: string;
  profile_id: string;
  timestamp: string;
  created_at: string;
  type: string;
  task_id: string | null;
  reward_id: string | null;
  gold_delta: string;
  user_gold: string;
  count_delta: string | null;
  duration: string | null;
  title_snapshot: string;
};
