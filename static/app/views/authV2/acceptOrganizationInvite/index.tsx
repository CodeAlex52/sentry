import {useTheme} from '@emotion/react';
import {AnimatePresence, motion} from 'framer-motion';

import {Alert} from '@sentry/scraps/alert';
import {Button} from '@sentry/scraps/button';
import {Stack} from '@sentry/scraps/layout';

import {t} from 'sentry/locale';
import {useParams} from 'sentry/utils/useParams';
import {OrganizationCard} from 'sentry/views/authV2/authLogin/components/organizationCard';
import {OrganizationSsoButton} from 'sentry/views/authV2/authLogin/components/organizationSsoButton';
import {getOrganizationSsoLoginUrl} from 'sentry/views/authV2/authLogin/utils';
import {useBrandedAuthLoading} from 'sentry/views/authV2/useBrandedAuthLoading';

import {InvitationAccountBadge} from './invitationAccountBadge';
import {InvitationAuthentication} from './invitationAuthentication';
import {InvitationLayout} from './invitationLayout';
import {InvitationStatus} from './invitationStatus';
import {useInvitationFlow} from './useInvitationFlow';

function AcceptOrganizationInvite() {
  const theme = useTheme();
  const params = useParams<{memberId: string; orgId: string; token: string}>();
  const {state, actions} = useInvitationFlow(params);
  useBrandedAuthLoading(state.status === 'loading');

  if (state.status === 'loading') {
    return null;
  }

  const switchAccountError = state.hasSwitchAccountError ? (
    <Alert variant="danger">{t('Unable to switch accounts. Try again.')}</Alert>
  ) : null;

  if (state.status === 'invalid') {
    return (
      <InvitationLayout>
        <Alert variant="warning">
          {t(
            'This invitation is invalid or expired. Try signing in with a different account.'
          )}
        </Alert>
        {switchAccountError}
        <Button
          busy={state.isSwitchingAccount}
          disabled={state.isSwitchingAccount}
          onClick={actions.switchAccount}
        >
          {t('Switch account')}
        </Button>
      </InvitationLayout>
    );
  }

  if (state.status === 'unavailable') {
    return (
      <InvitationLayout>
        <Alert variant="danger">{t('Unable to load this invitation. Try again.')}</Alert>
        <Button
          busy={state.isRetrying}
          disabled={state.isRetrying}
          onClick={actions.retryInvitation}
        >
          {t('Try again')}
        </Button>
      </InvitationLayout>
    );
  }

  const {authOrganization, initialEmail, loginConfig, signedInUser, step} = state;
  const ssoAction = authOrganization.provider ? (
    <OrganizationSsoButton
      authOrganization={authOrganization}
      hideWhenUnavailable
      ssoFormAction={getOrganizationSsoLoginUrl(authOrganization.organization.slug)}
    />
  ) : undefined;

  return (
    <InvitationLayout>
      <OrganizationCard authOrganization={authOrganization} action={ssoAction} />

      {switchAccountError}

      {signedInUser && (
        <InvitationAccountBadge
          user={signedInUser}
          onSwitchAccount={actions.switchAccount}
        />
      )}

      {state.hasAcceptError && (
        <Alert variant="danger">
          {t('Failed to accept this invitation. Please try again.')}
        </Alert>
      )}

      <AnimatePresence initial={false} mode="wait">
        <MotionStack
          key={step}
          gap="lg"
          initial={{opacity: 0, y: -10}}
          animate={{opacity: 1, y: 0}}
          exit={{opacity: 0, y: 10}}
          transition={theme.motion.framer.smooth.moderate}
        >
          {step === 'authentication' ? (
            <InvitationAuthentication
              authConfig={loginConfig}
              initialEmail={initialEmail}
              onAuthenticated={actions.handleAuthenticated}
            />
          ) : (
            <InvitationStatus
              step={step}
              isAccepting={state.isAccepting}
              onAccept={actions.acceptInvitation}
              onSwitchAccount={actions.switchAccount}
            />
          )}
        </MotionStack>
      </AnimatePresence>
    </InvitationLayout>
  );
}

const MotionStack = motion.create(Stack);

export default AcceptOrganizationInvite;
