-- Order.tif: 下单时的 time-in-force(POC/GTC)，供 route 数据展示；历史行无法确定，留 NULL。
ALTER TABLE "Order" ADD COLUMN "tif" TEXT;
-- Fill.notional: qty * price，写入时算好存下来，供成交额排序使用。
ALTER TABLE "Fill" ADD COLUMN "notional" DOUBLE PRECISION;

-- 历史 Fill 行的 qty/price 本身没有缺失，可以准确回填 notional；
-- 历史 Order 行的 tif 是真正丢失的下单意图数据，不回填，保持 NULL(前端显示"未知")。
UPDATE "Fill" SET "notional" = "qty" * "price" WHERE "notional" IS NULL;
