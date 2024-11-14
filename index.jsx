import React from 'react';
import ReactDOM from 'react-dom/client';
import Navigation from './components/Navigation'; // Asegúrate de la ruta correcta

const root = ReactDOM.createRoot(document.getElementById('root'));

// Renderiza Navigation directamente
root.render(
    <React.StrictMode>
        <Navigation />
    </React.StrictMode>
);
