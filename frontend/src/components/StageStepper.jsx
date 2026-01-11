import './StageStepper.css';

function stateLabel(state) {
  switch (state) {
    case 'done':
      return 'done';
    case 'running':
      return 'running';
    case 'error':
      return 'error';
    default:
      return 'waiting';
  }
}

function connectorState(leftState) {
  if (leftState === 'done') return 'done';
  if (leftState === 'running') return 'running';
  if (leftState === 'error') return 'error';
  return 'idle';
}

function Step({ index, title, state }) {
  const isDone = state === 'done';
  const circleText = isDone ? '✓' : String(index);

  return (
    <div className={`stepper-step ${state}`}>
      <div className="stepper-circle" aria-hidden="true">
        {circleText}
      </div>
      <div className="stepper-text">
        <div className="stepper-title">{title}</div>
        <div className="stepper-state">{stateLabel(state)}</div>
      </div>
    </div>
  );
}

function Connector({ state }) {
  return <div className={`stepper-connector ${state}`} aria-hidden="true" />;
}

/**
 * Stage 1 → 3 workflow visualization.
 * @param {{
 *  stage1: 'not_started'|'running'|'done'|'error',
 *  stage2: 'not_started'|'running'|'done'|'error',
 *  stage3: 'not_started'|'running'|'done'|'error',
 *  errorMessage?: string|null,
 * }} props
 */
export default function StageStepper({ stage1, stage2, stage3, errorMessage }) {
  return (
    <div className="stage-stepper">
      <div className="stage-stepper-row">
        <Step index={1} title="Stage 1" state={stage1} />
        <Connector state={connectorState(stage1)} />
        <Step index={2} title="Stage 2" state={stage2} />
        <Connector state={connectorState(stage2)} />
        <Step index={3} title="Stage 3" state={stage3} />
      </div>

      {errorMessage ? (
        <div className="stage-stepper-error" role="alert">
          {String(errorMessage)}
        </div>
      ) : null}
    </div>
  );
}

