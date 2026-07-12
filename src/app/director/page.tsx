import { DirectorClient } from "./DirectorClient";

export const metadata = { title: "Scenario Director · SDAL" };

// Hidden operator surface — deliberately outside the doctrine shell.
export default function DirectorPage() {
  return <DirectorClient />;
}
