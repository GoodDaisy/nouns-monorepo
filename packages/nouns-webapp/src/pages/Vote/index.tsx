import { Row, Col, Button, Card, Spinner } from 'react-bootstrap';
import Section from '../../layout/Section';
import {
  PartialProposal,
  ProposalState,
  useCancelProposal,
  useCurrentQuorum,
  useExecuteProposal,
  useProposal,
  useProposalVersions,
  useQueueProposal,
} from '../../wrappers/nounsDao';
import { useUserVotesAsOfBlock } from '../../wrappers/nounToken';
import classes from './Vote.module.css';
import { Link, RouteComponentProps } from 'react-router-dom';
import { TransactionStatus, useBlockNumber, useEthers } from '@usedapp/core';
import { AlertModal, setAlertModal } from '../../state/slices/application';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import advanced from 'dayjs/plugin/advancedFormat';
import en from 'dayjs/locale/en';
import VoteModal from '../../components/VoteModal';
import React, { useCallback, useEffect, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../hooks';
import clsx from 'clsx';
import ProposalHeader from '../../components/ProposalHeader';
import ProposalContent from '../../components/ProposalContent';
import VoteCard, { VoteCardVariant } from '../../components/VoteCard';
import { useQuery } from '@apollo/client';
import {
  proposalVotesQuery,
  delegateNounsAtBlockQuery,
  ProposalVotes,
  Delegates,
  propUsingDynamicQuorum,
} from '../../wrappers/subgraph';
import { getNounVotes } from '../../utils/getNounsVotes';
import { Trans } from '@lingui/macro';
import { i18n } from '@lingui/core';
import { ReactNode } from 'react-markdown/lib/react-markdown';
import { AVERAGE_BLOCK_TIME_IN_SECS } from '../../utils/constants';
import { SearchIcon } from '@heroicons/react/solid';
import ReactTooltip from 'react-tooltip';
import DynamicQuorumInfoModal from '../../components/DynamicQuorumInfoModal';
import config from '../../config';
import ShortAddress from '../../components/ShortAddress';
import StreamWithdrawModal from '../../components/StreamWithdrawModal';
import { parseStreamCreationCallData } from '../../utils/streamingPaymentUtils/streamingPaymentUtils';
import VoteSignals from '../../components/VoteSignals/VoteSignals';
import { useActiveLocale } from '../../hooks/useActivateLocale';
import { SUPPORTED_LOCALE_TO_DAYSJS_LOCALE, SupportedLocale } from '../../i18n/locales';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(advanced);

const getCountdownCopy = (
  proposal: PartialProposal,
  currentBlock: number,
  locale: SupportedLocale,
) => {
  const timestamp = Date.now();
  const endDate =
    proposal && timestamp && currentBlock
      ? dayjs(timestamp).add(
          AVERAGE_BLOCK_TIME_IN_SECS * (proposal.endBlock - currentBlock),
          'seconds',
        )
      : undefined;

  return (
    <Trans>
      {dayjs(endDate)
        .locale(SUPPORTED_LOCALE_TO_DAYSJS_LOCALE[locale] || en)
        .fromNow(true)}
    </Trans>
  );
};

const VotePage = ({
  match: {
    params: { id },
  },
}: RouteComponentProps<{ id: string }>) => {
  const proposal = useProposal(id);
  const proposalVersions = useProposalVersions(id);
  console.log('proposalVersions', proposalVersions);
  const { account } = useEthers();
  const activeLocale = useActiveLocale();

  const [showVoteModal, setShowVoteModal] = useState<boolean>(false);
  const [showDynamicQuorumInfoModal, setShowDynamicQuorumInfoModal] = useState<boolean>(false);
  // Toggle between Noun centric view and delegate view
  const [isDelegateView, setIsDelegateView] = useState(false);

  const [isQueuePending, setQueuePending] = useState<boolean>(false);
  const [isExecutePending, setExecutePending] = useState<boolean>(false);
  const [isCancelPending, setCancelPending] = useState<boolean>(false);
  const [showStreamWithdrawModal, setShowStreamWithdrawModal] = useState<boolean>(false);
  const [streamWithdrawInfo, setStreamWithdrawInfo] = useState<{
    streamAddress: string;
    startTime: number;
    endTime: number;
    streamAmount: number;
    tokenAddress: string;
  } | null>(null);

  const dispatch = useAppDispatch();
  const setModal = useCallback((modal: AlertModal) => dispatch(setAlertModal(modal)), [dispatch]);
  const {
    data: dqInfo,
    loading: loadingDQInfo,
    error: dqError,
  } = useQuery(propUsingDynamicQuorum(id ?? '0'));

  const { queueProposal, queueProposalState } = useQueueProposal();
  const { executeProposal, executeProposalState } = useExecuteProposal();
  const { cancelProposal, cancelProposalState } = useCancelProposal();

  // Get and format date from data
  const timestamp = Date.now();
  const currentBlock = useBlockNumber();
  const startDate =
    proposal && timestamp && currentBlock
      ? dayjs(timestamp).add(
          AVERAGE_BLOCK_TIME_IN_SECS * (proposal.startBlock - currentBlock),
          'seconds',
        )
      : undefined;

  const endBlock = proposal?.objectionPeriodEndBlock || proposal?.endBlock;
  const endDate =
    proposal && timestamp && currentBlock
      ? dayjs(timestamp).add(AVERAGE_BLOCK_TIME_IN_SECS * (endBlock! - currentBlock), 'seconds')
      : undefined;
  const now = dayjs();

  // Get total votes and format percentages for UI
  const totalVotes = proposal
    ? proposal.forCount + proposal.againstCount + proposal.abstainCount
    : undefined;
  const forPercentage = proposal && totalVotes ? (proposal.forCount * 100) / totalVotes : 0;
  const againstPercentage = proposal && totalVotes ? (proposal.againstCount * 100) / totalVotes : 0;
  const abstainPercentage = proposal && totalVotes ? (proposal.abstainCount * 100) / totalVotes : 0;

  // Only count available votes as of the proposal created block
  const availableVotes = useUserVotesAsOfBlock(proposal?.createdBlock ?? undefined);

  const currentQuorum = useCurrentQuorum(
    config.addresses.nounsDAOProxy,
    proposal && proposal.id ? parseInt(proposal.id) : 0,
    dqInfo && dqInfo.proposal ? dqInfo.proposal.quorumCoefficient === '0' : true,
  );

  const hasSucceeded = proposal?.status === ProposalState.SUCCEEDED;
  const isInNonFinalState = [
    ProposalState.UPDATABLE,
    ProposalState.PENDING,
    ProposalState.ACTIVE,
    ProposalState.SUCCEEDED,
    ProposalState.QUEUED,
    ProposalState.OBJECTION_PERIOD,
  ].includes(proposal?.status!);
  const isCancellable =
    isInNonFinalState && proposal?.proposer?.toLowerCase() === account?.toLowerCase();

  const isUpdateable =
    proposal?.status == ProposalState.UPDATABLE &&
    proposal?.proposer?.toLowerCase() === account?.toLowerCase();

  const isAwaitingStateChange = () => {
    if (hasSucceeded) {
      return true;
    }
    if (proposal?.status === ProposalState.QUEUED) {
      return new Date() >= (proposal?.eta ?? Number.MAX_SAFE_INTEGER);
    }
    return false;
  };

  const isAwaitingDestructiveStateChange = () => {
    if (isCancellable) {
      return true;
    }
    return false;
  };

  const startOrEndTimeCopy = () => {
    if (startDate?.isBefore(now) && endDate?.isAfter(now)) {
      return <Trans>Ends</Trans>;
    }
    if (endDate?.isBefore(now)) {
      return <Trans>Ended</Trans>;
    }
    return <Trans>Starts</Trans>;
  };

  const startOrEndTimeTime = () => {
    if (!startDate?.isBefore(now)) {
      return startDate;
    }
    return endDate;
  };

  const moveStateButtonAction = hasSucceeded ? <Trans>Queue</Trans> : <Trans>Execute</Trans>;
  const moveStateAction = (() => {
    if (hasSucceeded) {
      return () => {
        if (proposal?.id) {
          return queueProposal(proposal.id);
        }
      };
    }
    return () => {
      if (proposal?.id) {
        return executeProposal(proposal.id);
      }
    };
  })();

  const destructiveStateButtonAction = isCancellable ? <Trans>Cancel</Trans> : '';
  const destructiveStateAction = (() => {
    if (isCancellable) {
      return () => {
        if (proposal?.id) {
          return cancelProposal(proposal.id);
        }
      };
    }
  })();

  const onTransactionStateChange = useCallback(
    (
      tx: TransactionStatus,
      successMessage?: ReactNode,
      setPending?: (isPending: boolean) => void,
      getErrorMessage?: (error?: string) => ReactNode | undefined,
      onFinalState?: () => void,
    ) => {
      switch (tx.status) {
        case 'None':
          setPending?.(false);
          break;
        case 'Mining':
          setPending?.(true);
          break;
        case 'Success':
          setModal({
            title: <Trans>Success</Trans>,
            message: successMessage || <Trans>Transaction Successful!</Trans>,
            show: true,
          });
          setPending?.(false);
          onFinalState?.();
          break;
        case 'Fail':
          setModal({
            title: <Trans>Transaction Failed</Trans>,
            message: tx?.errorMessage || <Trans>Please try again.</Trans>,
            show: true,
          });
          setPending?.(false);
          onFinalState?.();
          break;
        case 'Exception':
          setModal({
            title: <Trans>Error</Trans>,
            message: getErrorMessage?.(tx?.errorMessage) || <Trans>Please try again.</Trans>,
            show: true,
          });
          setPending?.(false);
          onFinalState?.();
          break;
      }
    },
    [setModal],
  );

  useEffect(
    () =>
      onTransactionStateChange(
        queueProposalState,
        <Trans>Proposal Queued!</Trans>,
        setQueuePending,
      ),
    [queueProposalState, onTransactionStateChange, setModal],
  );

  useEffect(
    () =>
      onTransactionStateChange(
        executeProposalState,
        <Trans>Proposal Executed!</Trans>,
        setExecutePending,
      ),
    [executeProposalState, onTransactionStateChange, setModal],
  );

  useEffect(
    () => onTransactionStateChange(cancelProposalState, 'Proposal Canceled!', setCancelPending),
    [cancelProposalState, onTransactionStateChange, setModal],
  );

  const activeAccount = useAppSelector(state => state.account.activeAccount);
  const {
    loading,
    error,
    data: voters,
  } = useQuery<ProposalVotes>(proposalVotesQuery(proposal?.id ?? '0'), {
    skip: !proposal,
  });

  const voterIds = voters?.votes?.map(v => v.voter.id);
  const { data: delegateSnapshot } = useQuery<Delegates>(
    delegateNounsAtBlockQuery(voterIds ?? [], proposal?.createdBlock ?? 0),
    {
      skip: !voters?.votes?.length,
    },
  );

  const { delegates } = delegateSnapshot || {};
  const delegateToNounIds = delegates?.reduce<Record<string, string[]>>((acc, curr) => {
    acc[curr.id] = curr?.nounsRepresented?.map(nr => nr.id) ?? [];
    return acc;
  }, {});

  const data = voters?.votes?.map(v => ({
    delegate: v.voter.id,
    supportDetailed: v.supportDetailed,
    nounsRepresented: delegateToNounIds?.[v.voter.id] ?? [],
  }));

  const [showToast, setShowToast] = useState(true);
  useEffect(() => {
    if (showToast) {
      setTimeout(() => {
        setShowToast(false);
      }, 5000);
    }
  }, [showToast]);

  if (!proposal || loading || !data || loadingDQInfo || !dqInfo) {
    return (
      <div className={classes.spinner}>
        <Spinner animation="border" />
      </div>
    );
  }

  if (error || dqError) {
    return <Trans>Failed to fetch</Trans>;
  }

  const isWalletConnected = !(activeAccount === undefined);
  const isActiveForVoting =
    proposal?.status === ProposalState.ACTIVE ||
    proposal?.status === ProposalState.OBJECTION_PERIOD;

  const forNouns = getNounVotes(data, 1);
  const againstNouns = getNounVotes(data, 0);
  const abstainNouns = getNounVotes(data, 2);
  const isV2Prop = dqInfo.proposal.quorumCoefficient > 0;

  return (
    <Section fullWidth={false} className={classes.votePage}>
      {showDynamicQuorumInfoModal && (
        <DynamicQuorumInfoModal
          proposal={proposal}
          againstVotesAbsolute={againstNouns.length}
          onDismiss={() => setShowDynamicQuorumInfoModal(false)}
          currentQuorum={currentQuorum}
        />
      )}
      <StreamWithdrawModal
        show={showStreamWithdrawModal}
        onDismiss={() => setShowStreamWithdrawModal(false)}
        {...streamWithdrawInfo}
      />
      <VoteModal
        show={showVoteModal}
        onHide={() => setShowVoteModal(false)}
        proposalId={proposal?.id}
        availableVotes={availableVotes || 0}
      />
      <Col lg={10} className={classes.wrapper}>
        {proposal && (
          <ProposalHeader
            proposal={proposal}
            proposalVersions={proposalVersions}
            isActiveForVoting={isActiveForVoting}
            isWalletConnected={isWalletConnected}
            submitButtonClickHandler={() => setShowVoteModal(true)}
          />
        )}
      </Col>
      <Col lg={10} className={clsx(classes.proposal, classes.wrapper)}>
        {proposal.status === ProposalState.EXECUTED &&
          proposal.details
            .filter(txn => txn?.functionSig.includes('createStream'))
            .map(txn => {
              const parsedCallData = parseStreamCreationCallData(txn.callData);
              if (parsedCallData.recipient.toLowerCase() !== account?.toLowerCase()) {
                return <></>;
              }

              return (
                <Row className={clsx(classes.section, classes.transitionStateButtonSection)}>
                  <span className={classes.boldedLabel}>
                    <Trans>Only visible to you</Trans>
                  </span>
                  <Col className="d-grid gap-4">
                    <Button
                      onClick={() => {
                        setShowStreamWithdrawModal(true);
                        setStreamWithdrawInfo({
                          streamAddress: parsedCallData.streamAddress,
                          startTime: parsedCallData.startTime,
                          endTime: parsedCallData.endTime,
                          streamAmount: parsedCallData.streamAmount,
                          tokenAddress: parsedCallData.tokenAddress,
                        });
                      }}
                      variant="primary"
                      className={classes.transitionStateButton}
                    >
                      <Trans>
                        Withdraw from Stream{' '}
                        <ShortAddress address={parsedCallData.streamAddress ?? ''} />
                      </Trans>
                    </Button>
                  </Col>
                </Row>
              );
            })}
        <Row className={clsx(classes.section, classes.transitionStateButtonSection)}>
          <Col className="d-grid gap-4">
            <div className={classes.proposerOptionsWrapper}>
              <div className={classes.proposerOptions}>
                <p>
                  <span className={classes.proposerOptionsHeader}>Proposer functions</span>
                  {isUpdateable && (
                    <>
                      <Trans>This proposal can be edited for the next </Trans>{' '}
                      {getCountdownCopy(proposal, currentBlock || 0, activeLocale)}
                    </>
                  )}
                  {isCancellable && !isUpdateable && (
                    <>
                      <Trans>This proposal can be canceled for the next </Trans>{' '}
                      {getCountdownCopy(proposal, currentBlock || 0, activeLocale)}
                    </>
                  )}
                </p>
                <div className="d-flex gap-3">
                  {(isAwaitingStateChange() || isAwaitingDestructiveStateChange()) && (
                    <>
                      {isAwaitingStateChange() && (
                        <Button
                          onClick={moveStateAction}
                          disabled={isQueuePending || isExecutePending}
                          variant="dark"
                          className={classes.transitionStateButton}
                        >
                          {isQueuePending || isExecutePending ? (
                            <Spinner animation="border" />
                          ) : (
                            <Trans>{moveStateButtonAction} Proposal ⌐◧-◧</Trans>
                          )}
                        </Button>
                      )}

                      {isAwaitingDestructiveStateChange() && (
                        <Button
                          onClick={destructiveStateAction}
                          disabled={isCancelPending}
                          className={clsx(classes.destructiveTransitionStateButton, classes.button)}
                        >
                          {isCancelPending ? (
                            <Spinner animation="border" />
                          ) : (
                            <Trans>{destructiveStateButtonAction} Proposal </Trans>
                          )}
                        </Button>
                      )}
                    </>
                  )}

                  {isUpdateable && (
                    <Link
                      to={`/update-proposal/${id}`}
                      className={clsx(classes.primaryButton, classes.button)}
                    >
                      Edit
                    </Link>
                  )}
                </div>
              </div>
            </div>
          </Col>
        </Row>

        <p
          onClick={() => setIsDelegateView(!isDelegateView)}
          className={classes.toggleDelegateVoteView}
        >
          {isDelegateView ? (
            <Trans>Switch to Noun view</Trans>
          ) : (
            <Trans>Switch to delegate view</Trans>
          )}
        </p>
        <Row>
          <VoteCard
            proposal={proposal}
            percentage={forPercentage}
            nounIds={forNouns}
            variant={VoteCardVariant.FOR}
            delegateView={isDelegateView}
            delegateGroupedVoteData={data}
          />
          <VoteCard
            proposal={proposal}
            percentage={againstPercentage}
            nounIds={againstNouns}
            variant={VoteCardVariant.AGAINST}
            delegateView={isDelegateView}
            delegateGroupedVoteData={data}
          />
          <VoteCard
            proposal={proposal}
            percentage={abstainPercentage}
            nounIds={abstainNouns}
            variant={VoteCardVariant.ABSTAIN}
            delegateView={isDelegateView}
            delegateGroupedVoteData={data}
          />
        </Row>

        {/* TODO abstract this into a component  */}
        <Row>
          <Col xl={4} lg={12}>
            <Card className={classes.voteInfoCard}>
              <Card.Body className="p-2">
                <div className={classes.voteMetadataRow}>
                  <div className={classes.voteMetadataRowTitle}>
                    <h1>
                      <Trans>Threshold</Trans>
                    </h1>
                  </div>
                  {isV2Prop && (
                    <ReactTooltip
                      id={'view-dq-info'}
                      className={classes.delegateHover}
                      getContent={dataTip => {
                        return <Trans>View Threshold Info</Trans>;
                      }}
                    />
                  )}
                  <div
                    data-for="view-dq-info"
                    data-tip="View Dynamic Quorum Info"
                    onClick={() => setShowDynamicQuorumInfoModal(true && isV2Prop)}
                    className={clsx(classes.thresholdInfo, isV2Prop ? classes.cursorPointer : '')}
                  >
                    <span>
                      {isV2Prop ? <Trans>Current Threshold</Trans> : <Trans>Threshold</Trans>}
                    </span>
                    <h3>
                      <Trans>
                        {isV2Prop ? i18n.number(currentQuorum ?? 0) : proposal.quorumVotes} votes
                      </Trans>
                      {isV2Prop && <SearchIcon className={classes.dqIcon} />}
                    </h3>
                  </div>
                </div>
              </Card.Body>
            </Card>
          </Col>
          <Col xl={4} lg={12}>
            <Card className={classes.voteInfoCard}>
              <Card.Body className="p-2">
                <div className={classes.voteMetadataRow}>
                  <div className={classes.voteMetadataRowTitle}>
                    <h1>{startOrEndTimeCopy()}</h1>
                  </div>
                  <div className={classes.voteMetadataTime}>
                    <span>
                      {startOrEndTimeTime() &&
                        i18n.date(new Date(startOrEndTimeTime()?.toISOString() || 0), {
                          hour: 'numeric',
                          minute: '2-digit',
                          timeZoneName: 'short',
                        })}
                    </span>
                    <h3>
                      {startOrEndTimeTime() &&
                        i18n.date(new Date(startOrEndTimeTime()?.toISOString() || 0), {
                          dateStyle: 'long',
                        })}
                    </h3>
                  </div>
                </div>
              </Card.Body>
            </Card>
          </Col>
          <Col xl={4} lg={12}>
            <Card className={classes.voteInfoCard}>
              <Card.Body className="p-2">
                <div className={classes.voteMetadataRow}>
                  <div className={classes.voteMetadataRowTitle}>
                    <h1>Snapshot</h1>
                  </div>
                  <div className={classes.snapshotBlock}>
                    <span>
                      <Trans>Taken at block</Trans>
                    </span>
                    <h3>{proposal.createdBlock}</h3>
                  </div>
                </div>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      </Col>
      <Row>
        {proposal?.status === ProposalState.PENDING ? (
          <>
            <Col xl={8} lg={12}>
              <ProposalContent proposal={proposal} />
            </Col>
            <Col xl={4} lg={12} className={classes.sidebar}>
              <VoteSignals availableVotes={availableVotes} proposal={proposal} />
            </Col>
          </>
        ) : (
          <ProposalContent proposal={proposal} />
        )}
      </Row>
    </Section>
  );
};

export default VotePage;
