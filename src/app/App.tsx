import { AppLayout } from '../layouts/AppLayout';
import { useUiStore } from '../shared/stores/uiStore';
import { useEffect } from 'react';

export default function App() {
  const theme = useUiStore((s) => s.theme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return <AppLayout />;
}
