// sw.js - Service Worker för Jukebox
const CACHE_NAME = 'jukebox-v1';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
    // Vi skickar bara vidare trafiken till nätverket just nu
    event.respondWith(fetch(event.request));
});