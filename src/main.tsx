import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { useStore } from './store';
import * as model from './model';
import * as actions from './actions';
import * as symbols from './symbols';

// handy for debugging from the browser console
if (import.meta.env.DEV) (window as any).schematizer = { useStore, model, actions, symbols };

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
