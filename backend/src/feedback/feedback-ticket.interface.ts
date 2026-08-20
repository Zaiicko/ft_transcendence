// Narrow interface + DI token so ChatService can trigger a ticket reopen
// without importing feedback.service.ts by value — that file imports
// ChatService already (FeedbackService replies through chat), so a value
// import the other way round is a genuine circular require: TypeScript's
// emitDecoratorMetadata captures `design:paramtypes` at class-decoration
// time, and whichever file finishes evaluating second sees the other's
// export as still-undefined, producing "Nest can't resolve dependencies"
// at boot (reproduced). This file imports nothing, so requiring it from
// either side can never cycle back.
export interface FeedbackTicketReopener {
  reopenLatestForUser(userId: number): Promise<void>;
}

export const FEEDBACK_TICKET_REOPENER = Symbol('FEEDBACK_TICKET_REOPENER');
