# StoryAgent 视觉设计规范

浅色主题，以白色、浅灰和深色文字为基础，橙色作为强调色。采用系统无衬线字体、柔和圆角和低透明度阴影。

## 色彩

| 名称 | 色值 |
| --- | --- |
| 背景 | `#f6f6f6` |
| 基础表面 | `#ffffff` |
| 暖白表面 | `#fffcf3` |
| 浅粉表面 | `#fff5f5` |
| 主文字 | `#222222` |
| 标题文字 | `#000000` |
| 次级文字 | `#595959` |
| 辅助文字 | `#767676` |
| 品牌强调 | `#ff5f00` |
| 主操作 | `#c64700` |
| 主操作悬停 | `#b44000` |
| 反色文字 | `#ffffff` |
| 控件边界 | `#8a8a8a` |
| 分隔线 | `rgba(0, 0, 0, .05)` |
| 中性填充 | `rgba(0, 0, 0, .04)` |
| 中性填充悬停 | `rgba(0, 0, 0, .08)` |
| 浅金填充 | `#ffeed5` |
| 深金文字 | `#955b02` |
| 暖橙填充 | `#f8e1d2` |
| 深橙文字 | `#a24000` |

小字号文字与背景的对比度至少为 4.5:1。白字主按钮采用 `#c64700`；`#ff5f00` 保留为图形强调色。

## 字体

```css
font-family: -apple-system, "Helvetica Neue", Helvetica, "PingFang SC",
  "Microsoft YaHei", "Source Han Sans SC", "Noto Sans CJK SC",
  "WenQuanYi Micro Hei", sans-serif;
```

| 级别 | 字号 | 行高 | 字重 |
| --- | --- | --- | --- |
| 辅助文字 | `12px` | `20px` | `400` |
| 正文 | `14px` | `22px` | `400` |
| 强调文字 | `16px` | `24px` | `500` |
| 小标题 | `20px` | `28px` | `500` |
| 中标题 | `24px` | `32px` | `500` |
| 大标题 | `28px` | `40px` | `500` |

常用字重为 400、500、600。正文、按钮、表单文字不低于 14px，辅助文字不低于 12px。中文保持默认字间距。

## 圆角

| 级别 | 数值 |
| --- | --- |
| 小 | `4px` |
| 中 | `8px` |
| 大 | `12px` |
| 全圆角 | `999px` |

## 阴影

| 级别 | 数值 |
| --- | --- |
| 轻 | `0 12px 38px rgba(0, 0, 0, .04)` |
| 中 | `0 12px 67px rgba(0, 0, 0, .04)` |
| 较强 | `0 4px 32px rgba(0, 0, 0, .08)` |

## 基础控件外观

| 类型 | 外观 |
| --- | --- |
| 主按钮 | 深橙底、白字、全圆角；文字 `14px / 22px / 500` |
| 次级按钮 | 白底、深色文字、细边框、全圆角 |
| 输入框 | 浅色底、深色文字、清晰边界；文字 `14px / 22px / 400` |
| 标签 | 浅色填充、同色系深色文字、全圆角 |

## 状态与动效

悬停以颜色变化反馈，选中状态采用明确的颜色、字重或标记。键盘焦点使用 `2px` 深橙色轮廓，轮廓偏移 `2px`。

过渡时长为 `150–250ms`，默认 `200ms`，缓动采用 `ease-out`。遵循 `prefers-reduced-motion`，关闭非必要动画。

## CSS Token

```css
:root {
  --font-sans: -apple-system, "Helvetica Neue", Helvetica, "PingFang SC",
    "Microsoft YaHei", "Source Han Sans SC", "Noto Sans CJK SC",
    "WenQuanYi Micro Hei", sans-serif;

  --color-background: #f6f6f6;
  --color-surface: #ffffff;
  --color-surface-warm: #fffcf3;
  --color-surface-pink: #fff5f5;
  --color-text: #222222;
  --color-heading: #000000;
  --color-text-secondary: #595959;
  --color-text-muted: #767676;
  --color-text-inverse: #ffffff;
  --color-brand: #ff5f00;
  --color-primary: #c64700;
  --color-primary-hover: #b44000;
  --color-control-border: #8a8a8a;
  --color-divider: rgba(0, 0, 0, .05);
  --color-neutral: rgba(0, 0, 0, .04);
  --color-neutral-hover: rgba(0, 0, 0, .08);
  --color-gold-light: #ffeed5;
  --color-gold-dark: #955b02;
  --color-orange-light: #f8e1d2;
  --color-orange-dark: #a24000;

  --font-size-xs: 12px;
  --font-size-sm: 14px;
  --font-size-md: 16px;
  --font-size-lg: 20px;
  --font-size-xl: 24px;
  --font-size-2xl: 28px;
  --line-height-xs: 20px;
  --line-height-sm: 22px;
  --line-height-md: 24px;
  --line-height-lg: 28px;
  --line-height-xl: 32px;
  --line-height-2xl: 40px;
  --font-weight-regular: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;

  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-full: 999px;
  --shadow-sm: 0 12px 38px rgba(0, 0, 0, .04);
  --shadow-md: 0 12px 67px rgba(0, 0, 0, .04);
  --shadow-lg: 0 4px 32px rgba(0, 0, 0, .08);

  --focus-width: 2px;
  --focus-offset: 2px;
  --motion-duration: 200ms;
  --motion-easing: ease-out;
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --motion-duration: 0ms;
  }
}
```
