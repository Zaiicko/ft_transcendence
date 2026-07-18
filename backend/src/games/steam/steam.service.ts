import { Injectable, Logger } from '@nestjs/common';

// Public Steam store endpoint — no API key needed. num_per_page=0 returns
// only the aggregate summary, not the review texts.
const APPREVIEWS_URL = 'https://store.steampowered.com/appreviews';

export interface SteamReviewSummary {
  // % of positive reviews, 0-100 — null when the game has no reviews
  score: number | null;
  totalReviews: number;
}

@Injectable()
export class SteamService {
  private readonly logger = new Logger(SteamService.name);

  async fetchReviewSummary(appId: number): Promise<SteamReviewSummary> {
    const res = await fetch(
      `${APPREVIEWS_URL}/${appId}?json=1&language=all&purchase_type=all&num_per_page=0`,
    );
    if (!res.ok) {
      this.logger.warn(`Steam appreviews ${appId} failed (HTTP ${res.status})`);
      return { score: null, totalReviews: 0 };
    }
    const data = (await res.json()) as {
      query_summary?: { total_positive: number; total_reviews: number };
    };
    const summary = data.query_summary;
    if (!summary?.total_reviews) return { score: null, totalReviews: 0 };
    return {
      score: (summary.total_positive / summary.total_reviews) * 100,
      totalReviews: summary.total_reviews,
    };
  }
}
