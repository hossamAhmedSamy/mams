import * as dashboardService from "../../services/dashboard-service";
import { protectedProcedure, router } from "../trpc";

export const dashboardRouter = router({
  /**
   * Everything the person who runs the place needs before their first coffee.
   * Open to anyone signed in — every block inside is gated on what that person
   * may actually see, so a crew member simply gets an empty deck.
   */
  deck: protectedProcedure.query(({ ctx }) => dashboardService.ownerDeck(ctx.user)),
});
