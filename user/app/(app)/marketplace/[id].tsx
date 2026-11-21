import type { MarketplaceQuote } from "@jaxongirman/types";
import * as Crypto from "expo-crypto";
import { useLocalSearchParams, useRouter } from "expo-router";
import { BookOpenText, CheckCircle2, Flag, Gamepad2, Heart, Star, Store } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Image, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ErrorState, InlineError, SkeletonCard } from "@/components/StateBlocks";
import { useSuccessToast } from "@/components/SuccessToast";
import { formatShortDateTime } from "@/lib/datetime";
import { asErrorMessage } from "@/lib/format";
import { labelOf } from "@/lib/labels";
import { createSession } from "@/lib/games";
import {
  buyWithCoins, claimFreeProduct, fetchCoinQuote, refundPolicy, setCoinPrice, signPaths, toggleFavorite,
  type CoinQuote, type RefundPolicy,
} from "@/lib/marketplace";
import { formatCoins, formatSom } from "@/lib/money";
import { createMarketplaceOrder } from "@/lib/orders";
import { supabase } from "@/lib/supabase";
import { useCoinFeeQuote } from "@/lib/wallet";
import { useAccount } from "@/providers/AccountProvider";
import { useAuth } from "@/providers/AuthProvider";
import { usePaymentPolicy } from "@/providers/PaymentPolicyProvider";
import { icon, radius, shadow, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Detail = {
  product: {
    id: string; title: string; description: string; status: string;
    material_type: string; material_label: string | null; supports_editor_import: boolean;
    base_price: number; currency: string; cover_path: string | null;
    /** The optional second price in J Tanga; absent from a server before coin sales. */
    coin_price?: number | null;
    content_units: number | null; file_format: string | null; has_study_guide: boolean;
    sales_count: number; rating: number | null; rating_count: number;
    created_at: string; updated_at: string; is_own: boolean;
  };
  seller: { id: string; name: string; username: string | null; avatar_url: string | null; product_count: number } | null;
  previews: { path: string; mime_type: string }[];
  tags: { slug: string; label: string }[];
  reviews: { id: string; rating: number; body: string; created_at: string; author: string }[];
  quote: MarketplaceQuote;
  /** Whether the store sells for J Tanga at all right now (an admin switch). */
  coin_sales?: boolean;
  owned: boolean;
  is_favorite: boolean;
};

/** Why a listing is reported; the words are in the `market` table under `product.reason`. */
const REPORT_REASONS = [
  { code: "copyright" }, { code: "plagiarism" }, { code: "inappropriate" }, { code: "fraud" }, { code: "other" },
] as const;

/**
 * One listing.
 *
 * The payable total comes from the server's own quote, never from arithmetic
 * done here — the platform's fee is configuration an admin can change while
 * this screen is open.
 */
export default function ProductDetailScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation(["market", "common"]);
  const notify = useSuccessToast();
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ id?: string }>();
  const productId = typeof params.id === "string" ? params.id : "";

  const [detail, setDetail] = useState<Detail | null>(null);
  const [images, setImages] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  /**
   * The shape of a game listing — how many questions, of which kinds — without
   * a single question text. Correct answers stay behind the purchase; so do the
   * prompts, because a shopper who could read them would not need to buy.
   */
  const policy = usePaymentPolicy();
  const [hosting, setHosting] = useState(false);
  const [gamePreview, setGamePreview] = useState<{
    game_id: string; question_count: number; difficulty: string; types: Record<string, number>;
  } | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [refund, setRefund] = useState<RefundPolicy | null>(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundAgreed, setRefundAgreed] = useState(false);
  const [reportReason, setReportReason] = useState<string>("copyright");
  const [reportDetail, setReportDetail] = useState("");

  /*
   * Paying with J Tanga. The sheet shows the server's own quote — the price,
   * the balance now and after — and the purchase is one server call. Its key is
   * minted when the sheet opens, so pressing "Tasdiqlash" again after a dropped
   * response is the same purchase, never a second charge.
   */
  const { refresh: refreshAccount } = useAccount();
  const [coinOpen, setCoinOpen] = useState(false);
  const [coinQuote, setCoinQuote] = useState<CoinQuote | null>(null);
  const [coinBusy, setCoinBusy] = useState(false);
  const [coinError, setCoinError] = useState<string | null>(null);
  const [coinAgreed, setCoinAgreed] = useState(false);
  const coinKey = useRef("");

  /** The seller's own coin price, edited from here; the form only sets it at listing time. */
  const [priceEditOpen, setPriceEditOpen] = useState(false);
  const [priceText, setPriceText] = useState("");
  const [priceBusy, setPriceBusy] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);
  const editedPrice = Number.parseInt(priceText, 10) || 0;
  const editedFee = useCoinFeeQuote("store", editedPrice);

  const load = useCallback(async () => {
    if (!productId) return;
    setLoading(true);
    const { data, error: requestError } = await supabase.rpc("marketplace_product_detail", { p_product_id: productId });
    if (requestError) {
      setError(asErrorMessage(requestError));
    } else {
      const next = data as unknown as Detail;
      setDetail(next);
      setError(null);
      const paths = [next.product.cover_path, ...next.previews.map((preview) => preview.path)]
        .filter((path): path is string => Boolean(path));
      if (paths.length > 0) setImages(await signPaths("marketplace-previews", paths));

      if (next.product.material_type === "game") {
        const { data: preview } = await supabase.rpc("game_listing_preview", { p_product_id: productId });
        if (preview) setGamePreview(preview as unknown as typeof gamePreview);
      }
    }
    setLoading(false);
  }, [productId]);

  useEffect(() => { void load(); }, [load]);

  /** Hosting a bought game: the entitlement is what game_can_host() checks. */
  async function hostGame(gameId: string) {
    setHosting(true);
    setActionError(null);
    try {
      const session = await createSession(gameId);
      router.push({ pathname: "/(app)/oyingoh/host/[sessionId]", params: { sessionId: session.session_id } });
    } catch (failure) {
      setActionError(asErrorMessage(failure));
    } finally {
      setHosting(false);
    }
  }

  async function onFavorite() {
    if (!user || !detail) return;
    const next = !detail.is_favorite;
    setDetail({ ...detail, is_favorite: next });
    try {
      await toggleFavorite(productId, user.id, next);
    } catch {
      setDetail({ ...detail, is_favorite: !next });
    }
  }

  /**
   * Asks for the refund agreement before opening an order.
   *
   * The server refuses an unacknowledged purchase, so this modal is not what
   * enforces the rule — it is where somebody is actually told it, which is the
   * part a refusal alone cannot do.
   */
  async function startBuy() {
    if (!detail) return;
    setActionError(null);
    const current = refund ?? await refundPolicy().catch(() => null);
    setRefund(current);
    if (current) {
      setRefundAgreed(false);
      setRefundOpen(true);
      return;
    }
    await buy(false);
  }

  /** A free listing is taken, not bought: no order, no payment, straight to the library. */
  async function take() {
    setBusy(true);
    setActionError(null);
    try {
      await claimFreeProduct(productId);
      await load();
    } catch (takeError) {
      setActionError(asErrorMessage(takeError));
    } finally {
      setBusy(false);
    }
  }

  async function buy(acknowledged: boolean) {
    if (!detail) return;
    setBusy(true);
    setActionError(null);
    try {
      // Marketplace now enters the same order/payment engine as J Coin, modules
      // and web tariffs. One checkout means one partial-card source of truth.
      const order = await createMarketplaceOrder(productId, acknowledged);
      router.push({ pathname: "/(app)/checkout/[orderId]", params: { orderId: order.order_id } });
    } catch (checkoutError) {
      setActionError(asErrorMessage(checkoutError));
    } finally {
      setBusy(false);
      setRefundOpen(false);
    }
  }

  /** Opens the J Tanga sheet with a fresh quote, and the refund wording a so‘m purchase also asks for. */
  async function openCoinBuy() {
    setActionError(null);
    setCoinError(null);
    setCoinBusy(true);
    try {
      const [quote, policyText] = await Promise.all([
        fetchCoinQuote(productId),
        refund ? Promise.resolve(refund) : refundPolicy().catch(() => null),
      ]);
      setRefund(policyText);
      setCoinQuote(quote);
      setCoinAgreed(false);
      coinKey.current = Crypto.randomUUID();
      setCoinOpen(true);
    } catch (quoteError) {
      setActionError(asErrorMessage(quoteError));
    } finally {
      setCoinBusy(false);
    }
  }

  async function confirmCoinBuy() {
    if (!coinQuote?.coin_price) return;
    setCoinBusy(true);
    setCoinError(null);
    try {
      const result = await buyWithCoins(productId, coinKey.current, coinQuote.coin_price, Boolean(refund) && coinAgreed);
      setCoinOpen(false);
      notify(t("coins.done"), t("coins.doneBody", { balance: formatCoins(result.balance) }));
      void refreshAccount();
      await load();
    } catch (buyError) {
      setCoinError(asErrorMessage(buyError));
      // A price or a balance that moved is shown at once rather than on reopen.
      void fetchCoinQuote(productId).then(setCoinQuote).catch(() => undefined);
    } finally {
      setCoinBusy(false);
    }
  }

  /** Short of coins: the existing top-up screen, with this page left where it was. */
  function topUp() {
    setCoinOpen(false);
    router.push("/(app)/coins/buy");
  }

  function openPriceEdit(current: number | null) {
    setPriceError(null);
    setPriceText(current ? String(current) : "");
    setPriceEditOpen(true);
  }

  async function savePrice(next: number | null) {
    if (!detail) return;
    const wasLive = detail.product.status === "approved";
    setPriceBusy(true);
    setPriceError(null);
    try {
      const result = await setCoinPrice(productId, next);
      setPriceEditOpen(false);
      notify(t("coins.saved"), wasLive && result.status === "pending_review" ? t("coins.savedReview") : undefined);
      await load();
    } catch (saveError) {
      setPriceError(asErrorMessage(saveError));
    } finally {
      setPriceBusy(false);
    }
  }

  async function submitReport() {
    if (!user) return;
    setBusy(true);
    const { error: reportError } = await supabase.from("marketplace_reports").insert({
      product_id: productId,
      reporter_id: user.id,
      reason: reportReason as "copyright",
      detail: reportDetail.trim(),
    });
    setBusy(false);
    setReportOpen(false);
    if (reportError) {
      Alert.alert(t("product.reportFailed"), reportError.code === "23505" ? t("product.reportDuplicate") : asErrorMessage(reportError));
    } else {
      setReportDetail("");
      notify(t("product.reportSent"), t("product.reportSentBody"));
    }
  }

  if (loading) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title={t("product.fallback")} />
        <View style={styles.content}><SkeletonCard lines={3} /><SkeletonCard lines={3} /></View>
      </View>
    );
  }

  if (error || !detail) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title={t("product.fallback")} />
        <View style={styles.content}><ErrorState message={error ?? t("product.notFound")} onRetry={() => void load()} /></View>
      </View>
    );
  }

  const { product, seller, quote } = detail;
  const cover = product.cover_path ? images[product.cover_path] : undefined;
  /**
   * The coin price, where it can be paid: coin sales open, a paid listing, and
   * a platform whose store is open at all (the server refuses the rest).
   */
  const coinPrice = detail.coin_sales && product.base_price > 0 && policy.paymentsEnabled ? product.coin_price ?? null : null;
  const ownerPrices = product.is_own && product.base_price > 0 && detail.coin_sales === true
    && policy.paymentsEnabled && product.status !== "archived";
  const feeLabel = editedFee
    ? editedFee.fee_min > 0
      ? t("coins.feeMin", { rate: editedFee.fee_percent, min: formatCoins(editedFee.fee_min) })
      : t("coins.fee", { rate: editedFee.fee_percent })
    : "";

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={product.material_label ?? t("product.fallback")}
        action={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={detail.is_favorite ? t("unfavorite") : t("favorite")}
            onPress={() => void onFavorite()}
            style={styles.headerAction}
          >
            <Heart
              color={detail.is_favorite ? colors.danger : colors.ink}
              fill={detail.is_favorite ? colors.danger : "transparent"}
              size={icon.sm}
              strokeWidth={2}
            />
          </Pressable>
        }
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.coverFrame}>
          {cover ? (
            <Image source={{ uri: cover }} style={styles.cover} resizeMode="cover" />
          ) : (
            <View style={styles.coverFallback}><Store color={colors.borderStrong} size={40} strokeWidth={1.6} /></View>
          )}
        </View>

        {detail.previews.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: "/(app)/marketplace/preview/[id]", params: { id: productId } })}
            style={styles.previewOpen}
          >
            <Text style={styles.previewOpenText}>{t("product.preview")}</Text>
          </Pressable>
        ) : null}

        {detail.previews.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.previewStrip}>
            {detail.previews.map((preview) => (
              <Image key={preview.path} source={{ uri: images[preview.path] }} style={styles.previewImage} resizeMode="cover" />
            ))}
          </ScrollView>
        ) : null}

        <Text style={styles.title}>{product.title}</Text>

        {seller ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: "/(app)/(tabs)/marketplace" })}
            style={styles.sellerRow}
          >
            <Text style={styles.sellerName}>{seller.name}</Text>
            <Text style={styles.sellerMeta}>{t("product.sellerCount", { count: seller.product_count })}</Text>
          </Pressable>
        ) : null}

        <View style={styles.statRow}>
          {product.rating !== null ? (
            <View style={styles.stat}>
              <Star color={colors.warning} fill={colors.warning} size={14} strokeWidth={2} />
              <Text style={styles.statValue}>{product.rating.toFixed(1)}</Text>
              <Text style={styles.statLabel}>({product.rating_count})</Text>
            </View>
          ) : null}
          <View style={styles.stat}><Text style={styles.statValue}>{product.sales_count}</Text><Text style={styles.statLabel}>{t("product.sold")}</Text></View>
          {product.content_units ? (
            <View style={styles.stat}><Text style={styles.statValue}>{product.content_units}</Text><Text style={styles.statLabel}>{t("product.units")}</Text></View>
          ) : null}
          {product.file_format ? (
            <View style={styles.stat}><Text style={styles.statValue}>{product.file_format.toUpperCase()}</Text></View>
          ) : null}
        </View>

        {product.has_study_guide ? (
          <View style={styles.guideCard}>
            <BookOpenText color={colors.primary} size={18} strokeWidth={2} />
            <Text style={styles.guideText}>
              {t("product.guide")}
            </Text>
          </View>
        ) : null}

        {gamePreview ? (
          <View style={styles.guideCard}>
            <Gamepad2 color={colors.primary} size={18} strokeWidth={2} />
            <Text style={styles.guideText}>
              {t("product.questions", { count: gamePreview.question_count })} · {labelOf("gameDifficulty", gamePreview.difficulty)}
              {Object.keys(gamePreview.types).length > 0
                ? ` · ${Object.entries(gamePreview.types)
                    .map(([type, count]) => `${labelOf("gameType", type)} (${count})`)
                    .join(", ")}`
                : ""}
            </Text>
          </View>
        ) : null}

        {product.description ? <Text style={styles.description}>{product.description}</Text> : null}

        {!policy.paymentsEnabled && !detail.owned && !product.is_own && product.base_price > 0 ? (
          <View style={styles.guideCard}>
            <Text style={styles.guideText}>{policy.unavailableMessage("marketplace")}</Text>
          </View>
        ) : null}

        {/* The breakdown is the server's, shown in full so the total is never a
            surprise at the payment step. */}
        {product.base_price === 0 ? (
          <View style={styles.priceCard}>
            <View style={styles.priceLine}>
              <Text style={styles.priceTotalLabel}>{t("product.price")}</Text>
              <Text style={styles.priceTotal}>{t("product.free")}</Text>
            </View>
          </View>
        ) : policy.showPrices ? (
        <View style={styles.priceCard}>
          <View style={styles.priceLine}>
            <Text style={styles.priceLabel}>{t("product.price")}</Text>
            <Text style={styles.priceValue}>{formatSom(quote.base_price)}</Text>
          </View>
          <View style={styles.priceLine}>
            <Text style={styles.priceLabel}>{t("product.fee", { rate: quote.buyer_fee_rate })}</Text>
            <Text style={styles.priceValue}>{formatSom(quote.buyer_fee_amount)}</Text>
          </View>
          <View style={styles.priceDivider} />
          <View style={styles.priceLine}>
            <Text style={styles.priceTotalLabel}>{t("product.total")}</Text>
            <Text style={styles.priceTotal}>{formatSom(quote.buyer_total)}</Text>
          </View>
          {/* The other way to pay, under the same card: the coin price is the
              whole of it — the platform's share comes out of the seller's side. */}
          {coinPrice ? (
            <>
              <View style={styles.priceDivider} />
              <View style={styles.priceLine}>
                <Text style={styles.priceTotalLabel}>{t("coins.label")}</Text>
                <Text style={styles.priceTotal}>{formatCoins(coinPrice)}</Text>
              </View>
            </>
          ) : null}
        </View>
        ) : null}

        {actionError ? <InlineError message={actionError} /> : null}

        {(detail.owned || product.is_own) && gamePreview ? (
          <PrimaryButton
            label={t("product.startGame")}
            icon={Gamepad2}
            loading={hosting}
            onPress={() => void hostGame(gamePreview.game_id)}
          />
        ) : null}

        {detail.owned ? (
          <View style={styles.ownedCard}>
            <CheckCircle2 color={colors.success} size={20} strokeWidth={2} />
            <Text style={styles.ownedText}>{t("product.owned")}</Text>
            <Pressable onPress={() => router.push("/(app)/marketplace/library")}>
              <Text style={styles.ownedLink}>{t("toLibrary")}</Text>
            </Pressable>
          </View>
        ) : product.is_own ? (
          <View style={styles.ownedCard}>
            <Text style={styles.ownedText}>{t("product.own")}</Text>
          </View>
        ) : product.base_price === 0 ? (
          // Nothing is paid, so this works where payments are switched off too.
          <PrimaryButton label={t("product.take")} loading={busy} onPress={() => void take()} />
        ) : policy.paymentsEnabled ? (
          <PrimaryButton label={t("product.buy", { amount: formatSom(quote.buyer_total) })} loading={busy} onPress={() => void startBuy()} />
        ) : null}

        {!detail.owned && !product.is_own && coinPrice ? (
          <PrimaryButton
            label={t("coins.buy", { amount: formatCoins(coinPrice) })}
            tone="secondary"
            loading={coinBusy && !coinOpen}
            onPress={() => void openCoinBuy()}
          />
        ) : null}

        {ownerPrices ? (
          <View style={styles.coinOwnerRow}>
            <View style={styles.coinOwnerCopy}>
              <Text style={styles.priceLabel}>{t("coins.ownerLabel")}</Text>
              <Text style={styles.coinOwnerValue}>{product.coin_price ? formatCoins(product.coin_price) : t("coins.notSet")}</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={() => openPriceEdit(product.coin_price ?? null)} style={styles.coinOwnerEdit}>
              <Text style={styles.ownedLink}>{t("coins.edit")}</Text>
            </Pressable>
          </View>
        ) : null}

        {detail.reviews.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>{t("product.reviews")}</Text>
            <View style={styles.reviewList}>
              {detail.reviews.map((review) => (
                <View key={review.id} style={styles.review}>
                  <View style={styles.reviewHead}>
                    <Text style={styles.reviewAuthor}>{review.author}</Text>
                    <View style={styles.reviewStars}>
                      {Array.from({ length: 5 }, (_, index) => (
                        <Star
                          key={index}
                          color={index < review.rating ? colors.warning : colors.border}
                          fill={index < review.rating ? colors.warning : "transparent"}
                          size={11}
                          strokeWidth={2}
                        />
                      ))}
                    </View>
                  </View>
                  {review.body ? <Text style={styles.reviewBody}>{review.body}</Text> : null}
                  <Text style={styles.reviewDate}>{formatShortDateTime(review.created_at)}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        {!product.is_own ? (
          <Pressable accessibilityRole="button" onPress={() => setReportOpen(true)} style={styles.reportButton}>
            <Flag color={colors.inkSoft} size={14} strokeWidth={2} />
            <Text style={styles.reportText}>{t("product.report")}</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      {/* Said plainly, before the money: a digital file cannot be handed back,
          so the sale is final. The agreement travels with the order and is
          recorded against it, wording and all. */}
      <Modal visible={refundOpen} transparent animationType="fade" onRequestClose={() => setRefundOpen(false)}>
        <View style={styles.refundBackdrop}>
          <View style={styles.refundSheet}>
            <Text style={styles.refundTitle}>{refund?.title}</Text>
            <ScrollView style={styles.refundScroll}>
              <Text style={styles.refundBody}>{refund?.body}</Text>
            </ScrollView>

            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: refundAgreed }}
              onPress={() => setRefundAgreed((was) => !was)}
              style={styles.refundAgree}
            >
              <View style={[styles.refundBox, refundAgreed && styles.refundBoxOn]}>
                {refundAgreed ? <Text style={styles.refundTick}>✓</Text> : null}
              </View>
              <Text style={styles.refundAgreeText}>{refund?.checkboxLabel}</Text>
            </Pressable>

            <View style={styles.refundActions}>
              <Pressable accessibilityRole="button" onPress={() => setRefundOpen(false)} style={styles.refundCancel}>
                <Text style={styles.refundCancelText}>{t("common:cancel")}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={!refundAgreed || busy}
                onPress={() => void buy(true)}
                style={[styles.refundConfirm, (!refundAgreed || busy) && styles.refundDisabled]}
              >
                <Text style={styles.refundConfirmText}>{busy ? t("product.opening") : t("common:continue")}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Buying with J Tanga: the balance before and after, from the server's
          quote, and the same refund agreement a so‘m purchase asks for. Short of
          coins, the one action offered is the existing top-up screen. */}
      <Modal visible={coinOpen} transparent animationType="fade" onRequestClose={() => setCoinOpen(false)}>
        <View style={styles.refundBackdrop}>
          <View style={styles.refundSheet}>
            <Text style={styles.refundTitle}>{t("coins.confirmTitle")}</Text>
            <Text style={styles.refundBody}>{t("coins.confirmBody", { title: product.title })}</Text>

            {coinQuote ? (
              <View style={styles.coinSummary}>
                <View style={styles.priceLine}>
                  <Text style={styles.priceLabel}>{t("coins.price")}</Text>
                  <Text style={styles.priceValue}>{formatCoins(coinQuote.coin_price ?? 0)}</Text>
                </View>
                <View style={styles.priceLine}>
                  <Text style={styles.priceLabel}>{t("coins.balanceNow")}</Text>
                  <Text style={styles.priceValue}>{formatCoins(coinQuote.balance)}</Text>
                </View>
                {coinQuote.plan_coins > 0 ? (
                  <View style={styles.priceLine}>
                    <Text style={styles.priceLabel}>{t("coins.planCoins")}</Text>
                    <Text style={styles.priceValue}>{formatCoins(coinQuote.plan_coins)}</Text>
                  </View>
                ) : null}
                <View style={styles.priceDivider} />
                {coinQuote.enough ? (
                  <View style={styles.priceLine}>
                    <Text style={styles.priceTotalLabel}>{t("coins.balanceAfter")}</Text>
                    <Text style={styles.priceTotal}>{formatCoins(coinQuote.balance_after)}</Text>
                  </View>
                ) : (
                  <Text style={styles.coinShort}>{t("coins.short", { amount: formatCoins(coinQuote.shortfall) })}</Text>
                )}
                {coinQuote.plan_coins > 0 ? <Text style={styles.coinNote}>{t("coins.planNote")}</Text> : null}
              </View>
            ) : null}

            {coinQuote?.enough && refund ? (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: coinAgreed }}
                onPress={() => setCoinAgreed((was) => !was)}
                style={styles.refundAgree}
              >
                <View style={[styles.refundBox, coinAgreed && styles.refundBoxOn]}>
                  {coinAgreed ? <Text style={styles.refundTick}>✓</Text> : null}
                </View>
                <Text style={styles.refundAgreeText}>{refund.checkboxLabel}</Text>
              </Pressable>
            ) : null}

            {coinError ? <InlineError message={coinError} /> : null}

            <View style={styles.refundActions}>
              <Pressable accessibilityRole="button" onPress={() => setCoinOpen(false)} style={styles.refundCancel}>
                <Text style={styles.refundCancelText}>{t("common:cancel")}</Text>
              </Pressable>
              {coinQuote?.enough ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={(Boolean(refund) && !coinAgreed) || coinBusy}
                  onPress={() => void confirmCoinBuy()}
                  style={[styles.refundConfirm, ((Boolean(refund) && !coinAgreed) || coinBusy) && styles.refundDisabled]}
                >
                  <Text style={styles.refundConfirmText}>{coinBusy ? t("coins.buying") : t("coins.confirm")}</Text>
                </Pressable>
              ) : (
                <Pressable accessibilityRole="button" onPress={topUp} style={styles.refundConfirm}>
                  <Text style={styles.refundConfirmText}>{t("coins.topUp")}</Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>
      </Modal>

      {/* The seller's coin price. What they will receive is the server's
          figure for the fee in force, and a new price on a live listing is
          said to send it back to review before they press save. */}
      <Modal visible={priceEditOpen} transparent animationType="fade" onRequestClose={() => setPriceEditOpen(false)}>
        <KeyboardAvoidingView behavior="padding" style={styles.flex}>
          <View style={styles.refundBackdrop}>
            <View style={styles.refundSheet}>
              <Text style={styles.refundTitle}>{t("coins.ownerLabel")}</Text>
              <TextInput
                value={priceText}
                onChangeText={(value) => setPriceText(value.replace(/[^0-9]/g, "").slice(0, 7))}
                placeholder={t("coins.sellPlaceholder")}
                placeholderTextColor={colors.inkSoft}
                keyboardType="number-pad"
                style={styles.coinInput}
                accessibilityLabel={t("coins.ownerLabel")}
              />
              {editedFee ? (
                <View style={styles.coinSummary}>
                  <View style={styles.priceLine}>
                    <Text style={styles.priceLabel}>{feeLabel}</Text>
                    <Text style={styles.priceValue}>−{formatCoins(editedFee.fee)}</Text>
                  </View>
                  <View style={styles.priceLine}>
                    <Text style={styles.priceTotalLabel}>{t("coins.net")}</Text>
                    <Text style={styles.priceTotal}>{formatCoins(editedFee.net)}</Text>
                  </View>
                </View>
              ) : null}
              {product.status === "approved" && editedPrice > 0 && editedPrice !== product.coin_price ? (
                <Text style={styles.coinNote}>{t("coins.reviewWarning")}</Text>
              ) : null}
              {priceError ? <InlineError message={priceError} /> : null}
              <View style={styles.refundActions}>
                <Pressable accessibilityRole="button" onPress={() => setPriceEditOpen(false)} style={styles.refundCancel}>
                  <Text style={styles.refundCancelText}>{t("common:cancel")}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={editedPrice <= 0 || priceBusy}
                  onPress={() => void savePrice(editedPrice)}
                  style={[styles.refundConfirm, (editedPrice <= 0 || priceBusy) && styles.refundDisabled]}
                >
                  <Text style={styles.refundConfirmText}>{t("common:save")}</Text>
                </Pressable>
              </View>
              {product.coin_price ? (
                <Pressable accessibilityRole="button" disabled={priceBusy} onPress={() => void savePrice(null)} style={styles.coinRemove}>
                  <Text style={styles.coinRemoveText}>{t("coins.remove")}</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={reportOpen} transparent animationType="fade" onRequestClose={() => setReportOpen(false)}>
        {/* Above the keyboard on both platforms: Android draws a Modal edge to edge, where the system no longer resizes it. */}
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <Pressable accessibilityLabel={t("common:close")} onPress={() => setReportOpen(false)} style={styles.backdrop}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Text style={styles.sheetTitle}>{t("product.report")}</Text>
            <View style={styles.reasonRow}>
              {REPORT_REASONS.map((reason) => (
                <Pressable
                  key={reason.code}
                  onPress={() => setReportReason(reason.code)}
                  style={[styles.chip, reportReason === reason.code && styles.chipActive]}
                >
                  <Text style={[styles.chipText, reportReason === reason.code && styles.chipTextActive]}>{t(`product.reason.${reason.code}`)}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={reportDetail}
              onChangeText={(value) => setReportDetail(value.slice(0, 1000))}
              placeholder={t("product.reportDetail")}
              placeholderTextColor={colors.inkSoft}
              multiline
              style={styles.reportInput}
            />
            <PrimaryButton label={t("common:send")} loading={busy} onPress={() => void submitReport()} />
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: spacing.xl, paddingBottom: 60, gap: spacing.md },
  headerAction: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },

  coverFrame: { aspectRatio: 16 / 10, borderRadius: radius.lg, overflow: "hidden", backgroundColor: colors.surfaceMuted },
  cover: { width: "100%", height: "100%" },
  coverFallback: { flex: 1, alignItems: "center", justifyContent: "center" },
  refundBackdrop: { flex: 1, backgroundColor: "rgba(21, 14, 36, 0.55)", justifyContent: "flex-end" },
  refundSheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl, gap: spacing.md, maxHeight: "80%" },
  refundTitle: { ...typography.heading, color: colors.ink },
  refundScroll: { maxHeight: 220 },
  refundBody: { ...typography.body, color: colors.inkMuted, lineHeight: 22 },
  refundAgree: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  refundBox: { width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", marginTop: 1 },
  refundBoxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  refundTick: { color: colors.onPrimary, fontSize: 13, lineHeight: 16 },
  refundAgreeText: { ...typography.caption, color: colors.ink, flex: 1, lineHeight: 18 },
  refundActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  refundCancel: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  refundCancelText: { ...typography.bodyMedium, color: colors.inkMuted },
  refundConfirm: { flex: 1.4, paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: "center" },
  refundDisabled: { opacity: 0.5 },
  refundConfirmText: { ...typography.bodyMedium, color: colors.onPrimary },
  previewOpen: { alignSelf: "flex-start", paddingVertical: spacing.xs },
  previewOpenText: { ...typography.bodyMedium, color: colors.primary },
  previewStrip: { gap: spacing.sm, paddingVertical: 2 },
  previewImage: { width: 96, height: 72, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },

  title: { ...typography.title, color: colors.ink, fontSize: 22 },
  sellerRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  sellerName: { ...typography.bodyMedium, color: colors.primary, fontSize: 14 },
  sellerMeta: { ...typography.caption, color: colors.inkSoft },

  statRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.lg, paddingVertical: spacing.sm },
  stat: { flexDirection: "row", alignItems: "center", gap: 4 },
  statValue: { ...typography.bodyMedium, color: colors.ink, fontSize: 14 },
  statLabel: { ...typography.caption, color: colors.inkSoft },

  guideCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.primarySoft },
  guideText: { ...typography.caption, color: colors.primaryDeep, flex: 1, lineHeight: 18 },

  description: { ...typography.body, color: colors.inkMuted, lineHeight: 22 },

  priceCard: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.sm, ...shadow },
  priceLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  priceLabel: { ...typography.caption, color: colors.inkMuted },
  priceValue: { ...typography.caption, color: colors.ink },
  priceDivider: { height: 1, backgroundColor: colors.border, marginVertical: 2 },
  priceTotalLabel: { ...typography.bodyMedium, color: colors.ink },
  priceTotal: { ...typography.heading, color: colors.primaryDeep },

  flex: { flex: 1 },
  coinSummary: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceMuted },
  coinShort: { ...typography.bodyMedium, color: colors.danger },
  coinNote: { ...typography.caption, color: colors.inkMuted, lineHeight: 18 },
  coinInput: {
    ...typography.body, color: colors.ink, minHeight: 52, fontFamily: "JaxongirmanSans_700Bold", fontSize: 22,
    backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.lg,
  },
  coinRemove: { alignSelf: "center", paddingVertical: spacing.sm },
  coinRemoveText: { ...typography.caption, color: colors.danger },
  coinOwnerRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  coinOwnerCopy: { flex: 1, gap: 2 },
  coinOwnerValue: { ...typography.bodyMedium, color: colors.ink },
  coinOwnerEdit: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },

  ownedCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.successSoft, borderWidth: 1, borderColor: colors.successBorder },
  ownedText: { ...typography.caption, color: colors.ink, flex: 1 },
  ownedLink: { ...typography.caption, color: colors.primary, fontFamily: "JaxongirmanSans_600SemiBold" },

  sectionTitle: { ...typography.heading, color: colors.ink, marginTop: spacing.md },
  reviewList: { gap: spacing.sm },
  review: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 4 },
  reviewHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  reviewAuthor: { ...typography.bodyMedium, color: colors.ink, fontSize: 13 },
  reviewStars: { flexDirection: "row", gap: 1 },
  reviewBody: { ...typography.caption, color: colors.inkMuted, lineHeight: 18 },
  reviewDate: { ...typography.caption, fontSize: 10, color: colors.inkSoft },

  reportButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: spacing.lg },
  reportText: { ...typography.caption, color: colors.inkSoft },

  backdrop: { flex: 1, backgroundColor: "rgba(21,14,36,.45)", alignItems: "center", justifyContent: "center", padding: spacing.xl },
  sheet: { alignSelf: "stretch", gap: spacing.md, padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.surface },
  sheetTitle: { ...typography.heading, color: colors.ink },
  reasonRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.caption, color: colors.inkMuted },
  chipTextActive: { color: colors.onPrimary },
  reportInput: {
    ...typography.body, color: colors.ink, minHeight: 90, textAlignVertical: "top",
    backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
}));
