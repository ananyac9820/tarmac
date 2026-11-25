import { Lab } from './Lab';
import { Shell } from './Shell';
import { useClinicClock } from './live/store';
import { DataPage } from './pages/DataPage';
import { Display } from './pages/Display';
import { DoctorConsole } from './pages/DoctorConsole';
import { Home } from './pages/Home';
import { PatientApp } from './pages/PatientApp';
import { Reception } from './pages/Reception';
import { useRoute } from './router';

export function App() {
  useClinicClock();
  const { route, param } = useRoute();
  if (route === 'display') return <Display />;
  return (
    <Shell route={route}>
      {route === 'home' && <Home />}
      {route === 'patient' && <PatientApp key={param ?? 'me'} param={param} />}
      {route === 'reception' && <Reception />}
      {route === 'doctor' && <DoctorConsole param={param} />}
      {route === 'data' && <DataPage />}
      {route === 'how' && <Lab />}
    </Shell>
  );
}
