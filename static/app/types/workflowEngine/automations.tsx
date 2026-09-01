import type {Group} from 'sentry/types/group';
import type {Action} from 'sentry/types/workflowEngine/actions';
import type {
  DataCondition,
  DataConditionGroup,
} from 'sentry/types/workflowEngine/dataConditions';
import type {Detector} from 'sentry/types/workflowEngine/detectors';

export type NewAutomationAction = Omit<Action, 'id'>;
export type NewAutomationDataCondition = Omit<DataCondition, 'id'>;

interface NewAutomationDataConditionGroup extends Omit<
  DataConditionGroup,
  'actions' | 'conditions' | 'id'
> {
  conditions: NewAutomationDataCondition[];
  actions?: NewAutomationAction[];
}

interface AlertPreviewDataConditionGroup {
  conditions: Array<Pick<DataCondition, 'comparison' | 'type'>>;
  logicType: DataConditionGroup['logicType'];
}

interface AutomationBase {
  config: {frequency?: number};
  detectorIds: string[];
  enabled: boolean;
  environment: string | null;
  name: string;
}

export interface NewAutomation extends AutomationBase {
  actionFilters: NewAutomationDataConditionGroup[];
  triggers: NewAutomationDataConditionGroup | null;
}

export interface Automation extends Readonly<AutomationBase> {
  readonly actionFilters: DataConditionGroup[];
  readonly createdBy: string;
  readonly dateCreated: string;
  readonly dateUpdated: string;
  readonly id: string;
  readonly lastTriggered: string;
  readonly triggers: DataConditionGroup | null;
}

export type AlertPreviewRequest = {
  actionFilters: AlertPreviewDataConditionGroup[];
  config: AutomationBase['config'];
  projectIds: number[];
  triggers: AlertPreviewDataConditionGroup;
};

interface AlertPreviewResult {
  groupId: string;
  isThrottled: boolean;
  triggeredAt: string;
}

export interface AlertPreview {
  results: AlertPreviewResult[];
}

export interface AutomationFireHistory {
  count: number;
  eventId: string;
  group: Group;
  lastTriggered: string;
  detector?: Detector;
}

/**
 * Warning information about the status of actions in an automation.
 */
export type StatusWarning = {
  color: 'danger' | 'warning';
  message: string;
};
