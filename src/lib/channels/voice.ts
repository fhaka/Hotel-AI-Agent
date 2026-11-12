import twilio from "twilio";
import type { VoiceLanguage } from "./config";

/**
 * Pure TwiML builders for the phone channel (official SDK). Speech is
 * gathered turn by turn and every reply comes from the shared agent runtime.
 * Callers are always told up front that they are speaking with an AI.
 *
 * Phrases: short built-in texts per voice language. They should be reviewed
 * by native speakers before launch (see docs/setup/channels.md).
 */
const P: Record<string, { hello: (b: string) => string; ai: string; noInput: string; bye: string; slow: string; unavailable: string; transfer: string; noAnswer: string }> = {
  en: { hello: (b) => `Hello, you've reached ${b}.`, ai: "I'm an AI assistant. This conversation is transcribed, not recorded. How can I help you?", noInput: "Sorry, I didn't hear anything. How can I help?", bye: "Thank you for calling. Goodbye.", slow: "Sorry, that took too long. Could you say that again?", unavailable: "Sorry, this line is not available right now. Please try again later.", transfer: "One moment, I'll connect you with a member of our team.", noAnswer: "Nobody is available right now. We have your request and will get back to you. Goodbye." },
  de: { hello: (b) => `Hallo, Sie sind verbunden mit ${b}.`, ai: "Ich bin ein KI-Assistent. Das Gespräch wird als Text gespeichert, aber nicht aufgezeichnet. Wie kann ich Ihnen helfen?", noInput: "Entschuldigung, ich habe nichts gehört. Wie kann ich helfen?", bye: "Danke für Ihren Anruf. Auf Wiederhören.", slow: "Entschuldigung, das hat zu lange gedauert. Können Sie das bitte wiederholen?", unavailable: "Diese Leitung ist gerade nicht verfügbar. Bitte versuchen Sie es später erneut.", transfer: "Einen Moment, ich verbinde Sie mit unserem Team.", noAnswer: "Gerade ist niemand erreichbar. Wir haben Ihr Anliegen und melden uns. Auf Wiederhören." },
  fr: { hello: (b) => `Bonjour, vous êtes bien chez ${b}.`, ai: "Je suis un assistant d'intelligence artificielle. La conversation est transcrite, mais pas enregistrée. Comment puis-je vous aider ?", noInput: "Désolé, je n'ai rien entendu. Comment puis-je vous aider ?", bye: "Merci de votre appel. Au revoir.", slow: "Désolé, cela a pris trop de temps. Pouvez-vous répéter ?", unavailable: "Désolé, cette ligne n'est pas disponible pour le moment. Veuillez rappeler plus tard.", transfer: "Un instant, je vous mets en relation avec notre équipe.", noAnswer: "Personne n'est disponible pour le moment. Nous avons votre demande et reviendrons vers vous. Au revoir." },
  it: { hello: (b) => `Buongiorno, ha chiamato ${b}.`, ai: "Sono un assistente di intelligenza artificiale. La conversazione viene trascritta, ma non registrata. Come posso aiutarla?", noInput: "Mi scusi, non ho sentito nulla. Come posso aiutarla?", bye: "Grazie per la chiamata. Arrivederci.", slow: "Mi scusi, ci è voluto troppo tempo. Può ripetere?", unavailable: "Questa linea al momento non è disponibile. La preghiamo di riprovare più tardi.", transfer: "Un momento, la metto in contatto con il nostro staff.", noAnswer: "Al momento non è disponibile nessuno. Abbiamo la sua richiesta e la ricontatteremo. Arrivederci." },
  es: { hello: (b) => `Hola, ha llamado a ${b}.`, ai: "Soy un asistente de inteligencia artificial. La conversación se transcribe, pero no se graba. ¿En qué puedo ayudarle?", noInput: "Perdone, no he oído nada. ¿En qué puedo ayudarle?", bye: "Gracias por su llamada. Adiós.", slow: "Perdone, ha tardado demasiado. ¿Puede repetirlo?", unavailable: "Esta línea no está disponible en este momento. Inténtelo más tarde.", transfer: "Un momento, le paso con nuestro equipo.", noAnswer: "Ahora mismo no hay nadie disponible. Tenemos su solicitud y le contactaremos. Adiós." },
};

function phrases(language: VoiceLanguage) {
  return P[language.slice(0, 2)] ?? P.en;
}

type Say = { language: VoiceLanguage };

function gatherInto(response: InstanceType<typeof twilio.twiml.VoiceResponse>, opts: { language: VoiceLanguage; action: string; prompt: string }) {
  const g = response.gather({
    input: ["speech"],
    language: opts.language,
    speechTimeout: "auto",
    timeout: 6,
    action: opts.action,
    method: "POST",
    actionOnEmptyResult: true,
  });
  g.say({ language: opts.language } as Say, opts.prompt);
}

export function greetingTwiml(o: { businessName: string; greeting: string | null; language: VoiceLanguage; action: string }): string {
  const p = phrases(o.language);
  const r = new twilio.twiml.VoiceResponse();
  // The AI disclosure is always spoken, even with a custom greeting.
  gatherInto(r, { language: o.language, action: o.action, prompt: `${o.greeting?.trim() || p.hello(o.businessName)} ${p.ai}` });
  r.redirect({ method: "POST" }, o.action);
  return r.toString();
}

export function replyTwiml(o: { reply: string; language: VoiceLanguage; action: string; transferTo?: { phone: string; callerId: string } | null }): string {
  const p = phrases(o.language);
  const r = new twilio.twiml.VoiceResponse();
  if (o.transferTo) {
    r.say({ language: o.language } as Say, `${o.reply} ${p.transfer}`);
    r.dial({ timeout: 25, callerId: o.transferTo.callerId }, o.transferTo.phone);
    r.say({ language: o.language } as Say, p.noAnswer);
    r.hangup();
    return r.toString();
  }
  gatherInto(r, { language: o.language, action: o.action, prompt: o.reply });
  r.redirect({ method: "POST" }, o.action);
  return r.toString();
}

export function noInputTwiml(o: { language: VoiceLanguage; action: string; final: boolean }): string {
  const p = phrases(o.language);
  const r = new twilio.twiml.VoiceResponse();
  if (o.final) {
    r.say({ language: o.language } as Say, p.bye);
    r.hangup();
  } else {
    gatherInto(r, { language: o.language, action: o.action, prompt: p.noInput });
    r.redirect({ method: "POST" }, o.action);
  }
  return r.toString();
}

export function slowTwiml(o: { language: VoiceLanguage; action: string }): string {
  const r = new twilio.twiml.VoiceResponse();
  gatherInto(r, { language: o.language, action: o.action, prompt: phrases(o.language).slow });
  return r.toString();
}

export function unavailableTwiml(language: VoiceLanguage = "en-GB"): string {
  const r = new twilio.twiml.VoiceResponse();
  r.say({ language } as Say, phrases(language).unavailable);
  r.hangup();
  return r.toString();
}
