import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider, type MantineColorSchemeManager } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { restrictContextMenu } from './contextMenu';
import { theme } from './theme';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import App from "./App";

const colorSchemeManager: MantineColorSchemeManager = {
  get: () => 'light',
  set: () => {},
  clear: () => {},
  subscribe: () => {},
  unsubscribe: () => {},
};

document.addEventListener('contextmenu', restrictContextMenu);
if (import.meta.hot) import.meta.hot.dispose(() => document.removeEventListener('contextmenu', restrictContextMenu));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MantineProvider theme={theme} forceColorScheme="light" colorSchemeManager={colorSchemeManager}>
      <Notifications position="bottom-right" />
      <App />
    </MantineProvider>
  </React.StrictMode>,
);
