CREATE TABLE "Activity" (
 "id" UUID NOT NULL PRIMARY KEY, "groupId" UUID NOT NULL, "actorId" UUID NOT NULL,
 "actorName" VARCHAR(100) NOT NULL, "action" VARCHAR(32) NOT NULL,
 "referenceId" UUID NOT NULL, "referenceType" VARCHAR(16) NOT NULL,
 "eventKey" VARCHAR(180) NOT NULL, "data" JSONB NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "Activity_action_check" CHECK ("action" IN ('GROUP_CREATED','MEMBER_ADDED','MEMBER_LEFT','GROUP_INVITED','INVITATION_ACCEPTED','INVITATION_DECLINED','EXPENSE_CREATED','EXPENSE_UPDATED','REPAYMENT_RECORDED','REPAYMENT_REVERSED')),
 CONSTRAINT "Activity_referenceType_check" CHECK ("referenceType" IN ('GROUP','USER','EXPENSE','SETTLEMENT','INVITATION'))
);
CREATE UNIQUE INDEX "Activity_eventKey_key" ON "Activity"("eventKey");
CREATE INDEX "Activity_groupId_createdAt_id_idx" ON "Activity"("groupId","createdAt","id");
CREATE TABLE "Notification" (
 "id" UUID NOT NULL PRIMARY KEY, "userId" UUID NOT NULL, "activityId" UUID NOT NULL,
 "readAt" TIMESTAMPTZ(3), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "Notification_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Notification_userId_activityId_key" ON "Notification"("userId","activityId");
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId","readAt","createdAt");
CREATE TABLE "GroupInvitation" (
 "id" UUID NOT NULL PRIMARY KEY, "groupId" UUID NOT NULL, "inviterId" UUID NOT NULL, "inviteeId" UUID NOT NULL,
 "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING', "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "respondedAt" TIMESTAMPTZ(3),
 CONSTRAINT "GroupInvitation_status_check" CHECK (("status"='PENDING' AND "respondedAt" IS NULL) OR ("status" IN ('ACCEPTED','DECLINED') AND "respondedAt" IS NOT NULL)),
 CONSTRAINT "GroupInvitation_people_check" CHECK ("inviterId" <> "inviteeId"),
 CONSTRAINT "GroupInvitation_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "GroupInvitation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "GroupInvitation_inviteeId_fkey" FOREIGN KEY ("inviteeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "GroupInvitation_groupId_inviteeId_key" ON "GroupInvitation"("groupId","inviteeId");
CREATE INDEX "GroupInvitation_inviteeId_status_idx" ON "GroupInvitation"("inviteeId","status");
CREATE FUNCTION splitmate_append_only_activity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Activity is append-only' USING ERRCODE='23514'; END;
$$;
CREATE TRIGGER "Activity_append_only" BEFORE UPDATE OR DELETE ON "Activity" FOR EACH ROW EXECUTE FUNCTION splitmate_append_only_activity();
