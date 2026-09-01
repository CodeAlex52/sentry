import {useMutation} from '@tanstack/react-query';

import type {
  AlertPreview,
  AlertPreviewRequest,
} from 'sentry/types/workflowEngine/automations';
import {getApiUrl} from 'sentry/utils/api/getApiUrl';
import {fetchMutation} from 'sentry/utils/queryClient';
import {useOrganization} from 'sentry/utils/useOrganization';

export function useAlertPreview() {
  const organization = useOrganization();

  return useMutation({
    mutationKey: ['alert-preview', organization.slug],
    mutationFn: (data: AlertPreviewRequest) =>
      fetchMutation<AlertPreview[]>({
        url: getApiUrl('/organizations/$organizationIdOrSlug/workflows/preview/', {
          path: {organizationIdOrSlug: organization.slug},
        }),
        method: 'POST',
        data,
      }),
  });
}
