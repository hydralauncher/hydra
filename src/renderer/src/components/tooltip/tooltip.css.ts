import { style } from "@vanilla-extract/css";

export const tooltipStyle = style({
  position: 'relative',
  display: 'flex',
  cursor: 'pointer',
  alignItems: 'center'
});

export const tooltipTextStyle = style({
  visibility: 'hidden',
  backgroundColor: '#555',
  color: '#fff',
  textAlign: 'center',
  borderRadius: '6px',
  padding: '5px 5px',
  position: 'absolute',
  zIndex: '1',
  bottom: '125%',
  left: 'max(0%, min(100%, 50%))',
  transform: 'translateX(-50%)',
  ':after': {
    content: '""',
    position: 'absolute',
    top: '100%',
    left: '50%',
    marginLeft: '-5px',
    borderWidth: '5px',
    borderStyle: 'solid',
    borderColor: '#555 transparent transparent transparent',
  },
});

export const tooltipVisible = style({
  visibility: 'visible',
});
