import { useEffect, useState } from 'react';

/** Tiny hash router — works on any static host (Vercel, GitHub Pages, file://). */
export type Route = 'home' | 'patient' | 'reception' | 'doctor' | 'display' | 'data' | 'how';

const ROUTES: Route[] = ['home', 'patient', 'reception', 'doctor', 'display', 'data', 'how'];

function parse(): { route: Route; param: string | null } {
  const [r, param] = window.location.hash.replace(/^#\/?/, '').split('/');
  return { route: (ROUTES.includes(r as Route) ? r : 'home') as Route, param: param ?? null };
}

export function useRoute() {
  const [state, setState] = useState(parse);
  useEffect(() => {
    const on = () => {
      setState(parse());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return state;
}

export const href = (r: Route, param?: string) => `#/${r === 'home' ? '' : r}${param ? `/${param}` : ''}`;
