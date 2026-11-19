import { createTheme, ActionIcon, Badge, Button, Checkbox, Group, Input, InputWrapper, Modal, NavLink, NumberInput, Paper, Select, Tabs, Text, Textarea, Tooltip } from '@mantine/core';
import { createElement } from 'react';
import { Check } from './icons';
import classes from './theme.module.css';

export const theme = createTheme({
  primaryColor: 'story',
  primaryShade: 7,
  colors: {
    story: ['#fff4ec', '#ffeed5', '#f8e1d2', '#ffc59f', '#ff9e60', '#ff7c2e', '#ff5f00', '#c64700', '#b44000', '#a24000'],
  },
  black: '#222222',
  fontFamily: '-apple-system, "Helvetica Neue", Helvetica, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
  fontSizes: { xs: '12px', sm: '14px', md: '16px', lg: '20px', xl: '24px' },
  lineHeights: { xs: '1.67', sm: '1.57', md: '1.5', lg: '1.4', xl: '1.33' },
  headings: { fontWeight: '600', sizes: { h1: { fontSize: '24px', lineHeight: '1.4' }, h2: { fontSize: '20px', lineHeight: '1.4' }, h3: { fontSize: '16px', lineHeight: '1.5' }, h4: { fontSize: '14px', lineHeight: '1.57' } } },
  defaultRadius: 'md',
  radius: { xs: '4px', sm: '6px', md: '8px', lg: '12px', xl: '20px' },
  shadows: { xs: '0 12px 38px rgba(0,0,0,.04)', sm: '0 12px 67px rgba(0,0,0,.04)', md: '0 4px 32px rgba(0,0,0,.08)' },
  cursorType: 'pointer',
  respectReducedMotion: true,
  components: {
    Button: Button.extend({ defaultProps: { size: 'sm', radius: 'xl' }, styles: { root: { fontSize: '14px', fontWeight: 500, flexShrink: 0 } } }),
    ActionIcon: ActionIcon.extend({ defaultProps: { size: 34, variant: 'subtle', color: 'gray' } }),
    Checkbox: Checkbox.extend({ defaultProps: { size: 'sm', icon: ({ indeterminate: _indeterminate, ...props }) => createElement(Check, props) }, styles: { label: { fontSize: 14 } } }),
    NumberInput: NumberInput.extend({ defaultProps: { hideControls: true } }),
    Select: Select.extend({
      classNames: { option: classes.selectOption },
      defaultProps: {
        renderOption: ({ option, checked }) => createElement(Group, { gap: 'sm', justify: 'space-between', wrap: 'nowrap', w: '100%' },
          createElement(Text<'span'>, { component: 'span', size: 'sm' }, option.label),
          checked && createElement(Check, { size: 18, style: { flexShrink: 0 } })),
      },
    }),
    Input: Input.extend({ defaultProps: { size: 'sm' }, styles: (_theme, props) => ({ wrapper: props.variant === 'default' ? { '--input-bd': '#8a8a8a' } : {}, input: { fontSize: '14px', '--input-placeholder-color': '#767676' } }) }),
    InputWrapper: InputWrapper.extend({ styles: { label: { fontSize: '14px', color: '#595959', marginBottom: 6 } } }),
    Textarea: Textarea.extend({ styles: { input: { lineHeight: 1.8 } } }),
    Modal: Modal.extend({ defaultProps: { centered: true, radius: 'lg', padding: 'lg', transitionProps: { transition: 'fade-down', duration: 200, timingFunction: 'ease-out' }, overlayProps: { backgroundOpacity: .3, blur: 2 }, closeButtonProps: { 'aria-label': '关闭' } }, styles: { title: { fontSize: '20px', fontWeight: 600 }, header: { borderBottom: '1px solid #eee', marginBottom: 20 } } }),
    Paper: Paper.extend({ defaultProps: { radius: 'lg', withBorder: true, shadow: 'xs', p: 'lg' }, styles: { root: { borderColor: '#eeeeee' } } }),
    NavLink: NavLink.extend({ defaultProps: { variant: 'light' }, styles: { root: { borderRadius: '8px', minHeight: 44 }, label: { fontSize: '14px' } } }),
    Badge: Badge.extend({ defaultProps: { variant: 'light', color: 'gray', size: 'lg' }, styles: { root: { fontSize: '12px', fontWeight: 500, textTransform: 'none' } } }),
    Tabs: Tabs.extend({ defaultProps: { variant: 'pills' }, styles: { tab: { fontSize: '14px', minHeight: 36 } } }),
    Tooltip: Tooltip.extend({ defaultProps: { openDelay: 400 } }),
  },
});
