import {MessageRow, UserMessage} from '@sentry/scraps/chat';
import {Markdown} from '@sentry/scraps/markdown';

import {User} from 'sentry/components/seer/markdown/embeds/components/user';

import type {UserBlockProps} from './shared';

export function UserBlock({block}: UserBlockProps) {
  return (
    <MessageRow from="user">
      <UserMessage>
        <Markdown
          raw={block.message.content ?? ''}
          components={{
            Tag: ({Default, ...props}) =>
              props.name === 'user' ? <User {...props} /> : <Default {...props} />,
          }}
        />
      </UserMessage>
    </MessageRow>
  );
}
