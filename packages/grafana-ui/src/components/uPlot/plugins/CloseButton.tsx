import { css } from '@emotion/css';
import { Icon, Tooltip, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';

interface CloseButtonProps {
  onClick: () => void;
  tooltip?: string;
}

export function CloseButton({ onClick, tooltip = 'Close' }: CloseButtonProps) {
  const styles = useStyles2(getStyles);

  return (
    <Tooltip content={tooltip}>
      <button
        className={styles.closeButton}
        onClick={onClick}
        aria-label={tooltip}
      >
        <Icon name="times" size="sm" />
      </button>
    </Tooltip>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  closeButton: css({
    position: 'absolute',
    top: theme.spacing(0.5),
    right: theme.spacing(0.5),
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: theme.spacing(0.5),
    color: theme.colors.text.secondary,
    height: theme.spacing(2.5),
    width: theme.spacing(2.5),
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.shape.radius.default,
    '&:hover': {
      background: theme.colors.action.hover,
      color: theme.colors.text.primary,
    },
  }),
});