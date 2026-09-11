import { redirect } from "next/navigation";

/**
 * L'écran d'import vivait en double : ici, et à l'identique dans la section
 * « Import / Admin » de Paramètres (même `ImportForm`, même historique,
 * même bandeau de correspondances). Seul Paramètres était accessible depuis
 * la navigation ; cette route est conservée en simple redirection pour ne
 * pas casser les liens/marque-pages existants.
 */
export default function ImportAdminPage() {
  redirect("/parametres#import");
}
