import type {
  HistoryGameEntry,
  HistorySummary,
  PublishedEntry,
} from '#actions_pipeline/lib/historyStore.ts';

/** Two published days and a failed one, with distinct genres. */
export const HISTORY: HistoryGameEntry[] = [
  {
    date: '2026-08-27',
    status: 'published',
    model: 'a/model:free',
    slug: '2026-08-27-old-one',
    genre: 'puzzle',
    theme: 'floating lanterns',
    mechanics: ['drag', 'match'],
    title: 'Lantern Drift',
  },
  {
    date: '2026-08-28',
    status: 'published',
    model: 'b/model:free',
    slug: '2026-08-28-newer-one',
    genre: 'maze-adventure',
    theme: 'glass beetles',
    mechanics: ['move', 'collect'],
    title: 'Beetle Maze',
  },
  {
    date: '2026-08-26',
    status: 'failed_kept_previous',
    model: 'c/model:free',
    failureReasons: [],
    failureKinds: [],
  },
];

/** A summary with two leaderboard entries and a lessons note. */
export const SUMMARY: HistorySummary = {
  genreCounts: { puzzle: 3 },
  genreLastUsed: { puzzle: '2026-08-27' },
  popularityLeaderboard: [
    {
      slug: '2026-08-01-tide-garden',
      theme: 'tide clocks',
      mechanicsSummary: 'grow, wait',
      popularityScore: 41,
    },
    {
      slug: '2026-07-02-old-favourite',
      theme: 'stone birds',
      mechanicsSummary: 'glide',
      popularityScore: 90,
    },
  ],
  lessons: 'Canvas resize handlers often forget to rescale entity positions.',
};

/** A published entry with the given date, overridable field by field. */
export function received(date: string, over: Partial<PublishedEntry> = {}): PublishedEntry {
  return {
    date,
    status: 'published',
    model: 'a/model:free',
    slug: `${date}-game`,
    genre: 'puzzle',
    theme: 'tide clocks',
    mechanics: ['drag'],
    title: 'Tide Clock',
    ...over,
  };
}
