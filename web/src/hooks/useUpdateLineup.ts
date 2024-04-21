import { useMutation, useQueryClient } from '@tanstack/react-query';
import { UpdateChannelProgrammingRequest } from '@tunarr/types/api';
import { ZodiosError } from '@zodios/core';
import { useTunarrApi } from './useTunarrApi';
import { CondensedChannelProgramming } from '@tunarr/types';
import { isUndefined } from 'lodash-es';

type MutateArgs = {
  channelId: string;
  lineupRequest: UpdateChannelProgrammingRequest;
};

type Options = {
  onSuccess?: (result: CondensedChannelProgramming) => void | Promise<void>;
};

export const useUpdateLineup = (opts?: Options) => {
  const apiClient = useTunarrApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, lineupRequest }: MutateArgs) => {
      return apiClient.post('/api/channels/:id/programming', lineupRequest, {
        params: { id: channelId },
      });
    },
    onSuccess: async (response, { channelId }) => {
      await queryClient.invalidateQueries({
        queryKey: ['channels', channelId],
        exact: false,
      });
      if (!isUndefined(opts?.onSuccess)) {
        const result = opts.onSuccess(response);
        await Promise.resolve(result);
      }
    },
    onError: (error) => {
      if (error instanceof ZodiosError) {
        console.error(error.message, error.data, error.cause);
      }
    },
  });
};
