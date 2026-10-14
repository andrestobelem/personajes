import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Falta el contenedor de la aplicación');
createRoot(root).render(React.createElement(App));
