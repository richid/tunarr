import { isNonEmptyString } from '@/helpers/util.ts';
import { useApiQuery } from '../useApiQuery.ts';
import { every, sumBy } from 'lodash-es';
import { useTunarrApi } from '../useTunarrApi.ts';
import { useInfiniteQuery } from '@tanstack/react-query';

export const useJellyfinUserLibraries = (
  mediaSourceId: string,
  enabled: boolean = true,
) => {
  return useApiQuery({
    queryKey: ['jellyfin', mediaSourceId, 'user_libraries'],
    queryFn: (apiClient) =>
      apiClient.getJellyfinUserLibraries({ params: { mediaSourceId } }),
    enabled: enabled && isNonEmptyString(mediaSourceId),
  });
};

export const useJellyfinLibraryItems = (
  mediaSourceId: string,
  libraryId: string,
  pageParams: { offset: number; limit: number } | null = null,
  enabled: boolean = true,
) => {
  const key = [
    'jellyfin',
    mediaSourceId,
    'library_items',
    libraryId,
    pageParams,
  ];
  const result = useApiQuery({
    queryKey: key,
    queryFn: (apiClient) =>
      apiClient.getJellyfinLibraryMovies({
        params: { mediaSourceId, libraryId },
        queries: {
          offset: pageParams?.offset,
          limit: pageParams?.limit,
        },
      }),
    enabled: enabled && every([mediaSourceId, libraryId], isNonEmptyString),
  });
  return { ...result, queryKey: key };
};

export const useInfiniteJellyfinLibraryItems = (
  mediaSourceId: string,
  libraryId: string,
  pageParams: { offset: number; limit: number } | null = null,
  enabled: boolean = true,
) => {
  const apiClient = useTunarrApi();
  const key = [
    'jellyfin',
    mediaSourceId,
    'library_items',
    libraryId,
    pageParams,
  ];

  const result = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) =>
      apiClient.getJellyfinLibraryMovies({
        params: { mediaSourceId, libraryId },
        queries: {
          offset: pageParam,
          limit: 20,
        },
      }),
    enabled: enabled && every([mediaSourceId, libraryId], isNonEmptyString),
    initialPageParam: 0,
    getNextPageParam: (res, all, last) => {
      const total = sumBy(all, (page) => page.Items.length);
      if (total >= (res.TotalRecordCount ?? res.Items.length)) {
        return null;
      }

      // Next offset is the last + how many items we got back.
      return last + res.Items.length;
    },
  });

  return { ...result, queryKey: key };
};
