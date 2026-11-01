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

  buildTypes {
    debug {
      val api = localProperties.getProperty("ascooo.apiBaseUrl") ?: productionApi
      buildConfigField("String", "API_BASE_URL", "\"$api\"")
    }
    release {
      isMinifyEnabled = false
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
    }
  }
  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
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
  implementation(libs.kotlinx.coroutines.guava)

  implementation(libs.kotlinx.serialization.json)
  implementation(libs.okhttp)
  implementation(libs.retrofit)
  implementation(libs.retrofit.converter.kotlinx.serialization)
  implementation(libs.coil.compose)
  implementation(libs.coil.network.okhttp)

  testImplementation(libs.junit)
}
