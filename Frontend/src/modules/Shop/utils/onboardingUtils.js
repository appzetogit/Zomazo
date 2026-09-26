const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


const getOnboardingStorageKey = () => {
    try {
      const userStr = localStorage.getItem("seller_user")
      if (userStr) {
        const user = JSON.parse(userStr)
        const userId = user._id || user.id
        if (userId) return `seller_onboarding_data_${userId}`
      }
    } catch (e) {}
    return "seller_onboarding_data"
}
const ONBOARDING_STORAGE_KEY = getOnboardingStorageKey()

// Helper function to check if a step is complete
const isStepComplete = (stepData, stepNumber) => {
  if (!stepData) return false

  if (stepNumber === 1) {
    return (
      stepData.sellerName &&
      stepData.ownerName &&
      stepData.ownerEmail &&
      stepData.ownerPhone &&
      stepData.primaryContactNumber &&
      stepData.location?.area &&
      stepData.location?.city
    )
  }

  if (stepNumber === 2) {
    return (
      stepData.deliveryTimings?.openingTime &&
      stepData.deliveryTimings?.closingTime &&
      Array.isArray(stepData.openDays) &&
      stepData.openDays.length > 0 &&
      // Check for menu images (must have at least one)
      Array.isArray(stepData.menuImageUrls) &&
      stepData.menuImageUrls.length > 0 &&
      // Check for profile image
      stepData.profileImageUrl &&
      (stepData.profileImageUrl.url || typeof stepData.profileImageUrl === 'string')
    )
  }

  if (stepNumber === 3) {
    const hasPanImage = stepData.pan?.image && 
      (stepData.pan.image.url || typeof stepData.pan.image === 'string')
    const hasFssaiImage = stepData.fssai?.image && 
      (stepData.fssai.image.url || typeof stepData.fssai.image === 'string')
    // GST image is required only if GST is registered
    const hasGstImage = !stepData.gst?.isRegistered || 
      (stepData.gst?.image && (stepData.gst.image.url || typeof stepData.gst.image === 'string'))
    
    return (
      stepData.pan?.panNumber &&
      stepData.pan?.nameOnPan &&
      hasPanImage &&
      stepData.fssai?.registrationNumber &&
      hasFssaiImage &&
      hasGstImage &&
      stepData.bank?.accountNumber &&
      stepData.bank?.ifscCode &&
      stepData.bank?.accountHolderName &&
      stepData.bank?.accountType
    )
  }

  return false
}

const buildOnboardingLikeDataFromSeller = (seller) => {
  const onboarding = seller?.onboarding || {}

  const openingTime =
    seller?.openingTime ||
    seller?.deliveryTimings?.openingTime ||
    onboarding?.step2?.deliveryTimings?.openingTime
  const closingTime =
    seller?.closingTime ||
    seller?.deliveryTimings?.closingTime ||
    onboarding?.step2?.deliveryTimings?.closingTime

  return {
    completedSteps: onboarding.completedSteps,
    step1: onboarding.step1 || {
      sellerName: seller?.sellerName || seller?.name,
      ownerName: seller?.ownerName,
      ownerEmail: seller?.ownerEmail || seller?.email,
      ownerPhone: seller?.ownerPhone || seller?.phone,
      primaryContactNumber: seller?.primaryContactNumber,
      location:
        seller?.location ||
        (seller?.area || seller?.city || seller?.addressLine1
          ? {
              addressLine1: seller?.addressLine1,
              addressLine2: seller?.addressLine2,
              area: seller?.area,
              city: seller?.city,
              landmark: seller?.landmark,
            }
          : null),
    },
    step2: onboarding.step2 || {
      deliveryTimings:
        seller?.deliveryTimings ||
        (openingTime || closingTime ? { openingTime, closingTime } : null),
      openDays: seller?.openDays,
      menuImageUrls: seller?.menuImages,
      profileImageUrl: seller?.profileImage,
    },
    step3:
      onboarding.step3 ||
      (seller?.panNumber ||
      seller?.fssaiNumber ||
      seller?.accountNumber ||
      seller?.ifscCode
        ? {
            pan: {
              panNumber: seller?.panNumber,
              nameOnPan: seller?.nameOnPan,
              image: seller?.panImage,
            },
            gst: {
              isRegistered: Boolean(seller?.gstRegistered),
              gstNumber: seller?.gstNumber,
              legalName: seller?.gstLegalName,
              address: seller?.gstAddress,
              image: seller?.gstImage,
            },
            fssai: {
              registrationNumber: seller?.fssaiNumber,
              expiryDate: seller?.fssaiExpiry,
              image: seller?.fssaiImage,
            },
            bank: {
              accountNumber: seller?.accountNumber,
              ifscCode: seller?.ifscCode,
              accountHolderName: seller?.accountHolderName,
              accountType: seller?.accountType,
            },
          }
        : null),
  }
}

export const isSellerOnboardingComplete = (seller) => {
  if (!seller) return false

  // Approved sellers should never be forced into onboarding again.
  if (seller?.status === "approved") {
    return true
  }

  if (seller?.isActive === true) {
    return true
  }

  const onboardingLikeData = buildOnboardingLikeDataFromSeller(seller)
  if (onboardingLikeData.completedSteps === 4) {
    return true
  }

  const step1Complete = isStepComplete(onboardingLikeData.step1, 1)
  const step2Complete = isStepComplete(onboardingLikeData.step2, 2)
  const step3Complete = isStepComplete(onboardingLikeData.step3, 3)

  if (step1Complete && step2Complete && step3Complete) {
    return true
  }

  // Some older or migrated seller accounts have complete live profile data
  // without a reliable onboarding.completedSteps value.
  const hasOperationalProfile =
    Boolean(String(seller?.name || "").trim()) &&
    Boolean(String(seller?.sellerId || "").trim()) &&
    Boolean(String(seller?.slug || "").trim()) &&
    step1Complete &&
    step2Complete &&
    (seller?.approvedAt || seller?.rejectedAt || seller?.rejectionReason || seller?.isActive === false)

  if (hasOperationalProfile) {
    return true
  }

  return false
}

// Determine which step to show based on completeness
export const determineStepToShow = (data) => {
  if (!data) return 1

  // If completedSteps is 4, onboarding is complete (admin-created sellers)
  if (data.completedSteps === 4) {
    return null
  }

  // Check step 1
  if (!isStepComplete(data.step1, 1)) {
    return 1
  }

  // Check step 2
  if (!isStepComplete(data.step2, 2)) {
    return 2
  }

  // Check step 3
  if (!isStepComplete(data.step3, 3)) {
    return 3
  }

  // All steps complete - onboarding step 4 (payment) is handled on backend
  // User should be redirected to explore/dashboard after step 3 submission
  return null
}

