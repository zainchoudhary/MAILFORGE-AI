import { useAuth } from '../context/AuthContext';
import LandingExperience from '../components/landing/LandingExperience';

export default function Landing() {
  const { authenticated } = useAuth();
  return <LandingExperience authenticated={authenticated} />;
}
