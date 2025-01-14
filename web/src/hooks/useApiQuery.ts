import {
  DefaultError,
  QueryClient,
  QueryFunction,
  QueryKey,
  UseQueryOptions,
  UseQueryResult,
  UseSuspenseQueryResult,
  useQuery,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { getApiClient } from '../components/TunarrApiContext';
import { ApiClient } from '../external/api';

type ApiQueryOptions<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
> = Omit<UseQueryOptions<TQueryFnData, TError, TData, TQueryKey>, 'queryFn'> & {
  queryFn: (
    apiClient: ApiClient,
    ...rest: Parameters<QueryFunction<TQueryFnData, TQueryKey, never>>
  ) => ReturnType<QueryFunction<TQueryFnData, TQueryKey, never>>;
};

export function useApiQuery<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(
  options: ApiQueryOptions<TQueryFnData, TError, TData, TQueryKey>,
  queryClient?: QueryClient,
): UseQueryResult<TData, TError> {
  // NOTE that this query also depends on the backendUrl used to
  // create the API client, but we explicitly don't include it in the
  // queryKey here because:
  // 1. it makes the types super unwieldy
  // 2. we do a mass cache invalidation in the tunarr API context when
  //    the backend URL changes
  // 3. it keeps query keys simple for when we have to do more fine-grained
  //    invalidation (e.g. post-mutates)
  return useQuery(
    {
      ...options,
      queryFn: (args) => options.queryFn(getApiClient(), args),
    },
    queryClient,
  );
}

export function useApiSuspenseQuery<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(
  options: Omit<
    UseQueryOptions<TQueryFnData, TError, TData, TQueryKey>,
    'queryFn'
  > & {
    queryFn: (
      apiClient: ApiClient,
      ...rest: Parameters<QueryFunction<TQueryFnData, TQueryKey, never>>
    ) => ReturnType<QueryFunction<TQueryFnData, TQueryKey, never>>;
  },
  queryClient?: QueryClient,
): UseSuspenseQueryResult<TData, TError> {
  // NOTE that this query also depends on the backendUrl used to
  // create the API client, but we explicitly don't include it in the
  // queryKey here because:
  // 1. it makes the types super unwieldy
  // 2. we do a mass cache invalidation in the tunarr API context when
  //    the backend URL changes
  // 3. it keeps query keys simple for when we have to do more fine-grained
  //    invalidation (e.g. post-mutates)
  return useSuspenseQuery(
    {
      ...options,
      queryFn: (args) => options.queryFn(getApiClient(), args),
    },
    queryClient,
  );
}

export function apiQueryOptions<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(opts: ApiQueryOptions<TQueryFnData, TError, TData, TQueryKey>): typeof opts {
  return opts;
}
