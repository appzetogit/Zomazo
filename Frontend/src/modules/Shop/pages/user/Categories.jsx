import React, { useState, useEffect, useMemo } from "react";
import { useStoreMode } from "@store/context/StoreModeContext"
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Search, Grid2x2, ShoppingBag } from "lucide-react";
import { motion } from "framer-motion";
import { adminAPI } from "@store/api";
import { productImages } from "@store/constants/images";
import { resolveMediaUrl } from "@/shared/utils/mediaUrl";
import OptimizedImage from "@store/components/OptimizedImage";
import { useDeliveryLocation } from "@store/context/DeliveryLocationContext";
import useAppBackNavigation from "@store/hooks/useAppBackNavigation";
import { useStorefrontLayout } from "@store/components/user/desktop/useIsDesktop";
import { CategoriesDesktop } from "@store/components/user/desktop/IndexDesktop";

export default function Categories() {
  const { storePath } = useStoreMode()
  const navigate = useNavigate();
  const isDesktop = useStorefrontLayout();
  const goBack = useAppBackNavigation();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const { effectiveLocation: location, zoneId } = useDeliveryLocation();

  // resolveMediaUrl is the one place that knows how to turn a stored /uploads
  // path into a URL. The copy that used to live here stripped only a trailing
  // "/api", so with our "/api/v1" base every category image 404'd.
  const normalizeImageUrl = (imageUrl) => resolveMediaUrl(imageUrl);

  useEffect(() => {
    const fetchCategories = async () => {
      try {
        setLoading(true);
        const response = await adminAPI.getPublicCategories(zoneId ? { zoneId } : {});
        const list =
          response?.data?.data?.categories ||
          response?.data?.categories ||
          [];

        if (Array.isArray(list)) {
          const transformed = list.map((cat, idx) => ({
            id: String(cat?.id || cat?._id || cat?.slug || idx),
            name: cat?.name || "",
            slug: cat?.slug || String(cat?.name || "").toLowerCase().replace(/\s+/g, "-"),
            image: normalizeImageUrl(cat?.image || cat?.imageUrl) || productImages[idx % productImages.length],
            type: cat?.type || "",
          }));
          setCategories(transformed);
        }
      } catch (error) {
        console.error("Error fetching categories:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchCategories();
  }, [zoneId]);

  const filteredCategories = categories.filter((cat) =>
    (cat.name || "").toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Desktop (lg+): a grid of category cards; mobile below is unchanged.
  if (isDesktop) return <CategoriesDesktop categories={categories} loading={loading} />;

  return (
    <div className="min-h-screen bg-white dark:bg-[#0a0a0a] pb-10">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-white/80 dark:bg-[#0a0a0a]/80 backdrop-blur-md border-b border-neutral-100 dark:border-neutral-800 px-4 py-4 flex items-center gap-4">
        <button onClick={goBack} className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-full transition-colors active:scale-95">
          <ArrowLeft className="h-6 w-6 text-neutral-800 dark:text-neutral-200" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-neutral-900 dark:text-white tracking-tight">All Categories</h1>
          <p className="text-[10px] text-neutral-500 dark:text-neutral-400 font-bold uppercase tracking-widest leading-none mt-1">What's on your mind?</p>
        </div>
      </div>

      {/* Search Bar */}
      <div className="px-4 py-6">
        <div className="relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-neutral-400 dark:text-neutral-500 group-focus-within:text-wh-brand-ink transition-colors" />
          <input
            type="text"
            placeholder="Search specialties, categories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-4 py-4 bg-neutral-50 dark:bg-[#1a1a1a] border border-neutral-100 dark:border-neutral-800 rounded-2xl text-sm font-medium text-neutral-900 dark:text-white focus:outline-none focus:ring-4 focus:ring-wh-brand/5 focus:border-wh-brand transition-all placeholder:text-neutral-400 dark:placeholder:text-neutral-500"
          />
        </div>
      </div>

      {/* Grid */}
      <div className="px-4">
        {loading ? (
          <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-x-4 gap-y-10">
            {[...Array(12)].map((_, i) => (
              <div key={i} className="flex flex-col items-center gap-3 animate-pulse">
                <div className="w-full aspect-square rounded-full bg-neutral-100 dark:bg-neutral-800 border border-neutral-50 dark:border-neutral-700" />
                <div className="h-2 w-12 bg-neutral-100 dark:bg-neutral-800 rounded-full" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-x-4 gap-y-10">
            {filteredCategories.map((category, index) => {
              return (
                <motion.div
                  key={category.id || index}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.03 }}
                >
                  <Link
                    to={storePath(`/category/${category.slug}`)}
                    className="flex flex-col items-center gap-2.5 group"
                  >
                    <div className="relative w-full aspect-square rounded-full overflow-hidden shadow-sm border border-neutral-100 dark:border-neutral-800 bg-white dark:bg-[#1a1a1a] group-active:scale-90 transition-all duration-300">
                      <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/5 opacity-0 group-hover:opacity-100 transition-opacity z-10" />
                      <OptimizedImage
                        src={category.image}
                        alt={category.name}
                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                        sizes="(max-width: 640px) 25vw, 15vw"
                      />
                    </div>
                    <span className="text-[11px] font-bold text-neutral-700 dark:text-neutral-300 text-center leading-tight">
                      {category.name}
                    </span>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        )}

        {filteredCategories.length === 0 && !loading && (
          <div className="py-20 flex flex-col items-center text-center px-6">
            <div className="h-20 w-20 bg-neutral-50 dark:bg-neutral-900 rounded-full flex items-center justify-center mb-6">
              <Grid2x2 className="h-10 w-10 text-neutral-300 dark:text-neutral-700" />
            </div>
            <h3 className="text-lg font-bold text-neutral-900 dark:text-white">No results found</h3>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-2 max-w-[240px]">We couldn't find any categories matching your search. Try another keyword!</p>
            <button 
              onClick={() => setSearchQuery("")}
              className="mt-8 px-8 py-3 bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 rounded-2xl text-sm font-bold active:scale-95 transition-all shadow-lg"
            >
              Show all categories
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
