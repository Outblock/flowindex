import type { BSPageParams } from '@/types/blockscout';

interface LoadMorePaginationProps {
  nextPageParams: BSPageParams | null;
  isLoading: boolean;
  onLoadMore: (params: BSPageParams) => void;
}

export function LoadMorePagination({ nextPageParams, isLoading, onLoadMore }: LoadMorePaginationProps) {
  if (!nextPageParams) return null;

  return (
    <div className="flex justify-center py-4">
      <button
        onClick={() => onLoadMore(nextPageParams)}
        disabled={isLoading}
        className="px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isLoading ? 'Loading...' : 'Load More'}
      </button>
    </div>
  );
}
