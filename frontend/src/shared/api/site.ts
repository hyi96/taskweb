import { apiRequest } from "./client";

export type DailyPhraseResponse = {
  date: string;
  text: string;
  author: string;
};

export async function fetchDailyPhrase(): Promise<DailyPhraseResponse> {
  return apiRequest<DailyPhraseResponse>("/api/site/daily-phrase/");
}
