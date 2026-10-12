import { describe, expect, it } from "vitest";
import { mapClaimRequest } from "../src/repositories/claim-requests.js";

/**
 * yoyo-events Zod schema for claim responses expects:
 * { data: { id, providerId, providerName, userId, status, ... } }
 * Path ["data","userId"] fails when the API emits requesterUserId instead.
 */
describe("mapClaimRequest shape for events UI", () => {
  it("exposes userId (not requesterUserId) on the DTO", () => {
    const mapped = mapClaimRequest({
      id: "11111111-1111-1111-1111-111111111111",
      provider_id: "22222222-2222-2222-2222-222222222222",
      requester_user_id: "33333333-3333-3333-3333-333333333333",
      status: "pending",
      message: "test",
      contact_phone: "4076565432",
      contact_email: null,
      proof_url: null,
      admin_note: null,
      reviewed_by: null,
      reviewed_at: null,
      created_at: "2026-10-05T12:00:00.000Z",
      updated_at: "2026-10-05T12:00:00.000Z",
      provider: { name: "DiZeMaNePe" },
    });

    expect(mapped.userId).toBe("33333333-3333-3333-3333-333333333333");
    expect(mapped.providerName).toBe("DiZeMaNePe");
    expect(mapped).not.toHaveProperty("requesterUserId");
    expect(Object.keys(mapped).sort()).toEqual(
      [
        "adminNote",
        "contactEmail",
        "contactPhone",
        "createdAt",
        "id",
        "message",
        "proofUrl",
        "providerId",
        "providerName",
        "reviewedAt",
        "reviewedBy",
        "status",
        "updatedAt",
        "userId",
      ].sort(),
    );
  });
});
