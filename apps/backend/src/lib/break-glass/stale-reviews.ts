export type ReviewLike = {
  id: string;
  opened_at: Date | string;
  closed_at: Date | string | null;
};

type ReviewService<T extends ReviewLike> = {
  listBreakGlassReviews(filter: Record<string, unknown>, config?: Record<string, unknown>): Promise<T[]>;
};

/** Open reviews that have been open for at least `hours`, oldest first. */
export async function findStaleOpenReviews<T extends ReviewLike>(
  service: ReviewService<T>,
  now: Date,
  hours: number
): Promise<T[]> {
  const open = await service.listBreakGlassReviews({ closed_at: null }, { take: null });
  const cutoff = now.getTime() - hours * 3_600_000;
  return open
    .filter((review) => review.closed_at === null || review.closed_at === undefined)
    .filter((review) => new Date(review.opened_at).getTime() <= cutoff)
    .sort((a, b) => new Date(a.opened_at).getTime() - new Date(b.opened_at).getTime());
}
