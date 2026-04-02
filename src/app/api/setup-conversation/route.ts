import { NextRequest, NextResponse } from "next/server";
import { RtcTokenBuilder, RtcRole } from "agora-token";
import { generateChannelName, generateUid } from "@/lib/utils";

/**
 * POST /api/setup-conversation
 *
 * Generates an Agora RTC token and channel name for a new conversation.
 * The token allows the user to join the voice channel.
 */
export async function POST(req: NextRequest) {
  try {
    const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID;
    const appCertificate = process.env.AGORA_APP_CERTIFICATE;

    if (!appId || !appCertificate) {
      return NextResponse.json(
        { error: "Agora credentials not configured" },
        { status: 500 }
      );
    }

    const channelName = generateChannelName();
    const uid = generateUid();
    const botUid = parseInt(process.env.NEXT_PUBLIC_AGORA_BOT_UID || "1001");
    const expirationTimeInSeconds = 3600; // 1 hour
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

    // Generate token for the user
    // buildTokenWithUid takes 6 args: appId, appCertificate, channelName, uid, role, privilegeExpiredTs
    const token = RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCertificate,
      channelName,
      uid,
      RtcRole.PUBLISHER,
      privilegeExpiredTs
    );

    return NextResponse.json({
      appId,
      channelName,
      token,
      uid,
      botUid,
    });
  } catch (error) {
    console.error("Error setting up conversation:", error);
    return NextResponse.json(
      { error: "Failed to setup conversation" },
      { status: 500 }
    );
  }
}
