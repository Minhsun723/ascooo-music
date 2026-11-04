import java.util.Properties

plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.compose.compiler)
  alias(libs.plugins.kotlin.serialization)
}

// Debug builds may point at a local `wrangler dev` (reached from the phone through `adb reverse`)
// by setting ascooo.apiBaseUrl in local.properties; everything else talks to production.
val localProperties = Properties().apply {
  rootProject.file("local.properties").takeIf { it.exists() }?.inputStream()?.use(::load)
}
val productionApi = "https://music.ascooo.com"

// Release builds are signed with the key keystore.properties names. Both stay out of Git and need
// a backup of their own: an app signed with a lost key can't be updated, only reinstalled.
// Without the file, a release build comes out unsigned.
val keystoreProperties = Properties().apply {
  rootProject.file("keystore.properties").takeIf { it.exists() }?.inputStream()?.use(::load)
}

android {
  namespace = "com.ascooo.android.music"
  compileSdk {
    version = release(37) { minorApiLevel = 2 }
  }
  defaultConfig {
    applicationId = "com.ascooo.android.music"
    minSdk = 31
    targetSdk = 37
    versionCode = 1
    versionName = "0.1.0"
    buildConfigField("String", "API_BASE_URL", "\"$productionApi\"")
  }

  signingConfigs {
    if (!keystoreProperties.isEmpty) {
      create("release") {
        storeFile = rootProject.file(keystoreProperties.getProperty("storeFile"))
        storePassword = keystoreProperties.getProperty("storePassword")
        keyAlias = keystoreProperties.getProperty("keyAlias")
        keyPassword = keystoreProperties.getProperty("keyPassword")
      }
    }
  }
  buildTypes {
    debug {
      val api = localProperties.getProperty("ascooo.apiBaseUrl") ?: productionApi
      buildConfigField("String", "API_BASE_URL", "\"$api\"")
    }
    // The build to judge smoothness by and to use day to day: a debuggable build runs Compose
    // several times slower. R8 shrinks and optimizes the code; the libraries bring their own rules.
    release {
      signingConfig = signingConfigs.findByName("release")
      isMinifyEnabled = true
      isShrinkResources = true
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
    }
  }
  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  // Lists the app under Android's per-app language settings (13+). The locales come from the
  // res/values-* folders, so adding a translation adds it to the system picker by itself;
  // res/resources.properties says which language the unqualified res/values is.
  androidResources {
    generateLocaleConfig = true
  }
  buildFeatures {
    compose = true
    buildConfig = true
    aidl = false
    shaders = false
  }

  packaging {
    resources {
      excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
  }
}

kotlin {
  compilerOptions {
    optIn.addAll(
      "androidx.compose.material3.ExperimentalMaterial3Api",
      "androidx.compose.material3.ExperimentalMaterial3ExpressiveApi",
    )
  }
}

dependencies {
  implementation(platform(libs.androidx.compose.bom))

  implementation(libs.androidx.core.ktx)
  implementation(libs.androidx.activity.compose)
  implementation(libs.androidx.lifecycle.runtime.compose)
  implementation(libs.androidx.lifecycle.viewmodel.compose)
  implementation(libs.androidx.lifecycle.viewmodel.navigation3)
  implementation(libs.androidx.datastore.preferences)

  implementation(libs.androidx.compose.ui)
  implementation(libs.androidx.compose.ui.tooling.preview)
  implementation(libs.androidx.compose.material3)
  debugImplementation(libs.androidx.compose.ui.tooling)

  implementation(libs.androidx.navigation3.runtime)
  implementation(libs.androidx.navigation3.ui)

  implementation(libs.androidx.media3.exoplayer)
  implementation(libs.androidx.media3.session)
  implementation(libs.androidx.media3.datasource.okhttp)
  // Apple's motion artwork on artist pages: HLS, drawn by Compose.
  implementation(libs.androidx.media3.exoplayer.hls)
  implementation(libs.androidx.media3.ui.compose)
  implementation(libs.kotlinx.coroutines.guava)

  implementation(libs.kotlinx.serialization.json)
  implementation(libs.okhttp)
  implementation(libs.retrofit)
  implementation(libs.retrofit.converter.kotlinx.serialization)
  implementation(libs.coil.compose)
  implementation(libs.coil.network.okhttp)
  implementation(libs.material.color.utilities)

  testImplementation(libs.junit)
}
